"""KnowledgeRetriever - 知识库检索模块

从知识库中检索话单和字段信息，支持多种检索方式。

索引结构：
{
  "metadata": { ... },
  "records": { 话单名称: { ... } },
  "fields": { "话单名称|字段名": { ... } },
  "keywords": { 关键词: ["话单名称|字段名", ...] }
}
"""
import json
import re
from pathlib import Path
from typing import List, Dict, Optional
from difflib import SequenceMatcher
import jieba


def normalize_string(s: str) -> str:
    """字符串归一化：转小写、去除空格、下划线"""
    if not s:
        return ""
    return s.lower().replace(" ", "").replace("_", "").replace("-", "")


def fuzzy_match_ratio(s1: str, s2: str) -> float:
    """计算两个字符串的相似度"""
    if not s1 or not s2:
        return 0.0
    return SequenceMatcher(None, normalize_string(s1), normalize_string(s2)).ratio()


class KnowledgeRetriever:
    """知识库检索器"""

    # 匹配类型和置信度
    MATCH_TYPES = {
        "EXACT": 1.0,
        "CONTAIN": 0.8,
        "RECORD_MATCH": 0.7,
        "FUZZY": 0.6,
        "KEYWORD": 0.5
    }

    def __init__(self, knowledge_dir: str = None):
        if knowledge_dir:
            self.knowledge_dir = Path(knowledge_dir)
            self.manifest_file = self.knowledge_dir / "index_manifest.json"
            self.fields_dir = self.knowledge_dir / "fields"
        else:
            self.knowledge_dir = None
            self.manifest_file = None
            self.fields_dir = None
        self.index_data: Dict = {}
        self.fields_cache: Dict[str, List[Dict]] = {}  # 话单名称 -> 字段列表（缓存）

    def load_index(self, manifest_path: str = None):
        """加载索引清单文件（只有话单列表，很小）"""
        if manifest_path:
            self.manifest_file = Path(manifest_path)
            self.knowledge_dir = self.manifest_file.parent
            self.fields_dir = self.knowledge_dir / "fields"

        if not self.manifest_file or not self.manifest_file.exists():
            raise ValueError(f"索引清单文件不存在: {self.manifest_file}")

        with open(self.manifest_file, 'r', encoding='utf-8') as f:
            self.index_data = json.load(f)

    def _load_fields(self, record_name: str) -> List[Dict]:
        """按需加载话单的字段详情"""
        if record_name in self.fields_cache:
            return self.fields_cache[record_name]

        field_file = self.fields_dir / f"{record_name}.json"
        if not field_file.exists():
            return []

        with open(field_file, 'r', encoding='utf-8') as f:
            fields = json.load(f)
            self.fields_cache[record_name] = fields
            return fields

    def retrieve_fields(self, query: str, max_results: int = 50) -> List[Dict]:
        """检索字段

        Args:
            query: 查询关键词（话单名称或字段名）
            max_results: 最大返回结果数

        Returns:
            匹配的字段列表，按置信度排序
        """
        if not self.index_data:
            self.load_index()

        results = []
        query_norm = normalize_string(query)

        records = self.index_data.get('records', {})

        # 1. 话单名称精确匹配
        for record_name in records.keys():
            if normalize_string(record_name) == query_norm:
                fields = self._load_fields(record_name)
                for field in fields:
                    results.append({
                        "field": field,
                        "match_type": "EXACT",
                        "confidence": self.MATCH_TYPES["EXACT"],
                        "match_target": f"话单: {record_name}"
                    })
                return results

        # 2. 字段名精确匹配
        for record_name in records.keys():
            fields = self._load_fields(record_name)
            for field in fields:
                db_field_name = field.get('数据库字段名', '')
                if normalize_string(db_field_name) == query_norm:
                    results.append({
                        "field": field,
                        "match_type": "EXACT",
                        "confidence": self.MATCH_TYPES["EXACT"],
                        "match_target": db_field_name
                    })

        # 3. 包含匹配
        for record_name in records.keys():
            fields = self._load_fields(record_name)
            for field in fields:
                db_field_name = field.get('数据库字段名', '')
                field_cn = field.get('字段中文名', '')
                field_norm = normalize_string(db_field_name)
                field_cn_norm = normalize_string(field_cn)

                if (query_norm in field_norm or field_norm in query_norm or
                    query_norm in field_cn_norm or field_cn_norm in query_norm):
                    if not any(r['field'].get('数据库字段名') == db_field_name and
                              r['field'].get('话单名称') == field.get('话单名称') for r in results):
                        results.append({
                            "field": field,
                            "match_type": "CONTAIN",
                            "confidence": self.MATCH_TYPES["CONTAIN"],
                            "match_target": db_field_name
                        })

        # 4. 话单名称包含匹配
        for record_name in records.keys():
            if query_norm in normalize_string(record_name):
                fields = self._load_fields(record_name)
                for field in fields:
                    if not any(r['field'].get('数据库字段名') == field.get('数据库字段名') and
                              r['field'].get('话单名称') == record_name for r in results):
                        results.append({
                            "field": field,
                            "match_type": "RECORD_MATCH",
                            "confidence": self.MATCH_TYPES["RECORD_MATCH"],
                            "match_target": f"话单: {record_name}"
                        })

        # 5. 模糊匹配
        for record_name in records.keys():
            fields = self._load_fields(record_name)
            for field in fields:
                db_field_name = field.get('数据库字段名', '')
                field_cn = field.get('字段中文名', '')
                ratio = max(fuzzy_match_ratio(query, db_field_name),
                           fuzzy_match_ratio(query, field_cn))
                if ratio >= 0.6:
                    if not any(r['field'].get('数据库字段名') == db_field_name and
                              r['field'].get('话单名称') == field.get('话单名称') for r in results):
                        results.append({
                            "field": field,
                            "match_type": "FUZZY",
                            "confidence": ratio * self.MATCH_TYPES["FUZZY"],
                            "match_target": db_field_name
                        })

        # 按置信度排序
        results.sort(key=lambda x: x['confidence'], reverse=True)
        return results[:max_results]

    def get_fields_by_record(self, record_name: str) -> List[Dict]:
        """获取指定话单的所有字段"""
        return self._load_fields(record_name)

    def get_all_records(self) -> List[str]:
        """获取所有话单名称"""
        if not self.index_data:
            self.load_index()

        records = self.index_data.get('records', {})
        return list(records.keys())

    def get_statistics(self) -> Dict:
        """获取知识库统计信息"""
        if not self.index_data:
            self.load_index()

        metadata = self.index_data.get('metadata', {})
        records = self.index_data.get('records', {})
        fields = self.index_data.get('fields', {})

        return {
            'last_updated': metadata.get('last_updated', '未知'),
            'total_records': len(records),
            'total_fields': len(fields),
            'records': list(records.keys())
        }


def retrieve_fields(query: str, knowledge_dir: str, max_results: int = 50) -> List[Dict]:
    """便捷函数：检索字段"""
    retriever = KnowledgeRetriever(knowledge_dir)
    return retriever.retrieve_fields(query, max_results)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: knowledge_retriever.py <知识库目录> [查询关键词]")
        sys.exit(1)

    knowledge_dir = sys.argv[1]
    query = sys.argv[2] if len(sys.argv) > 2 else ""

    retriever = KnowledgeRetriever(knowledge_dir)

    if query:
        results = retriever.retrieve_fields(query)
        print(f"找到 {len(results)} 个匹配字段:")
        for r in results[:10]:
            field = r['field']
            print(f"  [{r['confidence']:.2f}] {field.get('话单名称')}.{field.get('数据库字段名')}: {field.get('字段中文名')}")
    else:
        stats = retriever.get_statistics()
        print(f"=== 知识库统计 ===")
        print(f"最后更新: {stats['last_updated']}")
        print(f"话单数量: {stats['total_records']}")
        print(f"字段数量: {stats['total_fields']}")
        print(f"\n话单列表:")
        for record in sorted(stats['records']):
            print(f"  - {record}")