"""Searcher - 智能检索DIS字段

基于新的索引结构进行检索，支持多种匹配方式。
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
from typing import Dict, List, Optional
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


class DisSearcher:
    """DIS字段搜索引擎"""

    # 匹配类型和置信度
    MATCH_TYPES = {
        "EXACT": 1.0,           # 精确匹配
        "RECORD_EXACT": 0.95,   # 话单名称精确匹配
        "CONTAIN": 0.8,         # 包含匹配
        "RECORD_MATCH": 0.7,    # 话单匹配（返回该话单所有字段）
        "FUZZY": 0.6,           # 模糊匹配
        "KEYWORD": 0.5          # 关键词匹配
    }

    # 非数据话单（版本记录等），搜索时跳过
    SKIP_PREFIXES = ("封面", "目录", "Sheet1")
    SKIP_CONTAINS = ("修订记录", "值域映射", "映射关系")

    def __init__(self, manifest_path: str):
        self.manifest_path = Path(manifest_path)
        self.index_data: Dict = {}
        self.fields_cache: Dict[str, List[Dict]] = {}  # 话单名称 -> 字段列表（缓存）
        self._load_manifest()

    def _load_manifest(self):
        """加载主索引文件（只有话单列表，很小）"""
        if not self.manifest_path.exists():
            raise ValueError(f"索引清单文件不存在: {self.manifest_path}")

        with open(self.manifest_path, 'r', encoding='utf-8') as f:
            self.index_data = json.load(f)

    def _load_fields(self, record_name: str) -> List[Dict]:
        """按需加载话单的字段详情"""
        if record_name in self.fields_cache:
            return self.fields_cache[record_name]

        # 从单独的文件加载
        field_file = self.manifest_path.parent / "fields" / f"{record_name}.json"
        if not field_file.exists():
            return []

        with open(field_file, 'r', encoding='utf-8') as f:
            fields = json.load(f)
            self.fields_cache[record_name] = fields
            return fields

    def search(self, query: str, max_results: int = None, min_confidence: float = 0.3, output_format: str = "markdown") -> str:
        """检索字段

        Args:
            query: 查询关键词（可以是话单名称或字段名）
            max_results: 最大返回结果数（None表示不限制）
            min_confidence: 最小置信度
            output_format: 输出格式 (markdown/json)

        Returns:
            检索结果
        """
        query = query.strip()
        if not query:
            return "错误: 查询词不能为空"

        results = self._do_search(query)

        # 按置信度排序
        results.sort(key=lambda x: x['confidence'], reverse=True)

        # 检查是否精确匹配了话单名称（话单匹配返回所有字段，不受限制）
        exact_record_match = any('话单精确匹配' in r.get('match_type', '') or '话单匹配' in r.get('match_type', '')
                                  for r in results[:5])

        # 过滤结果
        results = [r for r in results if r['confidence'] >= min_confidence]

        # 只有在不是话单精确匹配时才应用 max_results 限制
        if max_results is not None and not exact_record_match:
            results = results[:max_results]

        if output_format == "json":
            return json.dumps(results, ensure_ascii=False, indent=2)
        else:
            return self._format_markdown(query, results)

    def _do_search(self, query: str) -> List[Dict]:
        """执行检索"""
        results = []
        query_norm = normalize_string(query)

        records = self.index_data.get('records', {})
        aliases = self.index_data.get('aliases', {})
        keywords = self.index_data.get('keywords', {})

        # 过滤掉非数据话单
        valid_records = {}
        for name, info in records.items():
            skip = False
            for prefix in self.SKIP_PREFIXES:
                if name.startswith(prefix):
                    skip = True
                    break
            if not skip:
                for contains in self.SKIP_CONTAINS:
                    if contains in name:
                        skip = True
                        break
            if not skip:
                valid_records[name] = info

        # 检查是否精确匹配了某个话单名称（包括别名）
        exact_record_match = None
        for record_name in valid_records.keys():
            if normalize_string(record_name) == query_norm:
                exact_record_match = record_name
                break

        # 检查别名映射
        if exact_record_match is None:
            # 直接匹配别名
            if query in aliases:
                exact_record_match = aliases[query]
            # 尝试规范化后匹配别名
            elif query_norm in [normalize_string(a) for a in aliases.keys()]:
                for alias, record_name in aliases.items():
                    if normalize_string(alias) == query_norm:
                        exact_record_match = record_name
                        break

        # 1. 精确匹配话单名称 - 优先返回该话单的所有字段
        if exact_record_match:
            fields = self._load_fields(exact_record_match)
            for field in fields:
                results.append({
                    "field": field,
                    "confidence": self.MATCH_TYPES["RECORD_EXACT"],
                    "match_type": f"话单精确匹配: {exact_record_match}"
                })
            # 精确匹配话单时，不返回其他话单的字段（包括碰巧同名的字段）
            return results

        # 2. 精确匹配字段名（数据库字段名）- 需要遍历所有话单
        for record_name in valid_records.keys():
            fields = self._load_fields(record_name)
            for field in fields:
                db_field_name = field.get('数据库字段名', '')
                if normalize_string(db_field_name) == query_norm:
                    results.append({
                        "field": field,
                        "confidence": self.MATCH_TYPES["EXACT"],
                        "match_type": "字段精确匹配"
                    })
                    break

        # 3. 包含匹配字段名
        for record_name in valid_records.keys():
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
                            "confidence": self.MATCH_TYPES["CONTAIN"],
                            "match_type": "字段包含匹配"
                        })

        # 4. 话单名称包含匹配（返回该话单所有字段）
        for record_name, record_info in valid_records.items():
            if query_norm in normalize_string(record_name):
                fields = self._load_fields(record_name)
                for field in fields:
                    if not any(r['field'].get('数据库字段名') == field.get('数据库字段名') and
                              r['field'].get('话单名称') == record_name for r in results):
                        results.append({
                            "field": field,
                            "confidence": self.MATCH_TYPES["RECORD_MATCH"],
                            "match_type": f"话单匹配: {record_name}"
                        })

        # 5. 模糊匹配
        for record_name in valid_records.keys():
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
                            "confidence": ratio * self.MATCH_TYPES["FUZZY"],
                            "match_type": f"模糊匹配 ({int(ratio*100)}%)"
                        })

        # 6. 字段含义匹配
        for record_name in valid_records.keys():
            fields = self._load_fields(record_name)
            for field in fields:
                desc = field.get('字段含义', '')
                if query_norm in normalize_string(desc):
                    if not any(r['field'].get('数据库字段名') == field.get('数据库字段名') and
                              r['field'].get('话单名称') == field.get('话单名称') for r in results):
                        results.append({
                            "field": field,
                            "confidence": self.MATCH_TYPES["KEYWORD"],
                            "match_type": "字段含义匹配"
                        })

        return results

    def get_fields_by_record(self, record_name: str) -> List[Dict]:
        """获取指定话单的所有字段

        Args:
            record_name: 话单名称（支持别名）

        Returns:
            字段列表
        """
        # 支持别名查询
        aliases = self.index_data.get('aliases', {})
        if record_name in aliases:
            record_name = aliases[record_name]
        elif normalize_string(record_name) in [normalize_string(a) for a in aliases.keys()]:
            for alias, target in aliases.items():
                if normalize_string(alias) == normalize_string(record_name):
                    record_name = target
                    break

        return self._load_fields(record_name)

    def get_all_records(self) -> List[str]:
        """获取所有话单名称（排除非数据话单）"""
        records = self.index_data.get('records', {})
        valid = []
        for name in records.keys():
            skip = False
            for prefix in self.SKIP_PREFIXES:
                if name.startswith(prefix):
                    skip = True
                    break
            if not skip:
                for contains in self.SKIP_CONTAINS:
                    if contains in name:
                        skip = True
                        break
            if not skip:
                valid.append(name)
        return valid

    def resolve_alias(self, name: str) -> str:
        """解析话单名称（支持别名）

        Args:
            name: 话单名称或别名

        Returns:
            标准话单名称
        """
        records = self.index_data.get('records', {})
        aliases = self.index_data.get('aliases', {})

        # 直接在话单列表中查找
        if name in records:
            return name

        # 规范化匹配
        name_norm = normalize_string(name)
        for record_name in records.keys():
            if normalize_string(record_name) == name_norm:
                return record_name

        # 查找别名
        if name in aliases:
            return aliases[name]

        # 规范化别名匹配
        for alias, record_name in aliases.items():
            if normalize_string(alias) == name_norm:
                return record_name

        return name  # 未找到，返回原名称

    def _format_markdown(self, query: str, results: List[Dict]) -> str:
        """格式化为Markdown输出"""
        if not results:
            return f"## 检索结果\n\n未找到匹配 \"**{query}**\" 的字段\n"

        # 按话单分组统计
        by_record = {}
        for r in results:
            record = r['field'].get('话单名称', '未知')
            if record not in by_record:
                by_record[record] = []
            by_record[record].append(r)

        md_lines = []
        md_lines.append(f"## 检索结果")
        md_lines.append("")
        md_lines.append(f"查询词: **{query}**")
        md_lines.append(f"共找到 **{len(results)}** 个匹配字段：")
        md_lines.append("")

        for record_name, record_results in by_record.items():
            md_lines.append(f"### 话单: {record_name} ({len(record_results)}个字段)")
            md_lines.append("")
            md_lines.append("| 字段名 | 中文名 | 类型 | 说明 |")
            md_lines.append("|--------|--------|------|------|")
            for r in record_results:
                field = r['field']
                conf = int(r['confidence'] * 100)
                desc = field.get('字段含义', '')
                if len(desc) > 50:
                    desc = desc[:50] + "..."
                md_lines.append(f"| {field.get('数据库字段名', '')} | {field.get('字段中文名', '')} | {field.get('字段类型', '')} | {desc} |")
            md_lines.append("")

        return "\n".join(md_lines)


def search_dis(query: str, index_path: str, max_results: int = None, min_confidence: float = 0.3, output_format: str = "markdown") -> str:
    """检索DIS字段的入口函数"""
    searcher = DisSearcher(index_path)
    return searcher.search(query, max_results, min_confidence, output_format)


def get_record_stats(record_name: str = None, manifest_path: str = None) -> str:
    """获取话单统计信息

    Args:
        record_name: 话单名称（为空则返回所有话单统计）
        manifest_path: 索引清单文件路径

    Returns:
        统计信息（Markdown格式）
    """
    searcher = DisSearcher(manifest_path)
    metadata = searcher.index_data.get('metadata', {})
    records = searcher.index_data.get('records', {})

    if record_name:
        # 返回指定话单的统计
        if record_name in records:
            info = records[record_name]
            fields = searcher.get_fields_by_record(record_name)

            result = [
                f"## {record_name} 话单统计",
                "",
                f"- **话单名称**: {record_name}",
                f"- **字段总数**: {info.get('字段数', len(fields))}个",
                f"- **是否可见**: {info.get('是否可见', 'N')}",
                ""
            ]
            return "\n".join(result)
        else:
            return f"未找到话单: {record_name}"
    else:
        # 返回所有话单统计
        result = [
            "## 话单统计",
            "",
            f"- **总话单数**: {metadata.get('total_records', len(records))}个",
            f"- **总字段数**: {metadata.get('total_fields', 0)}个",
            f"- **最后更新**: {metadata.get('last_updated', '未知')}",
            "",
            "### 话单列表",
            ""
        ]

        # 按话单类型分组
        detail_cdr = []
        detail_ufdr = []
        ufdr = []
        tdr = []
        other = []

        for name in sorted(records.keys()):
            if name.startswith("DETAIL_CDR_"):
                detail_cdr.append(name)
            elif name.startswith("DETAIL_UFDR_"):
                detail_ufdr.append(name)
            elif name.startswith("UFDR_"):
                ufdr.append(name)
            elif name.startswith("TDR_"):
                tdr.append(name)
            else:
                other.append(name)

        if detail_cdr:
            result.append(f"**DETAIL_CDR_* 系列 ({len(detail_cdr)}个)**：")
            result.append(", ".join(detail_cdr[:10]))
            if len(detail_cdr) > 10:
                result.append(f"... 还有 {len(detail_cdr) - 10} 个话单")
            result.append("")

        if detail_ufdr:
            result.append(f"**DETAIL_UFDR_* 系列 ({len(detail_ufdr)}个)**：")
            result.append(", ".join(detail_ufdr[:10]))
            if len(detail_ufdr) > 10:
                result.append(f"... 还有 {len(detail_ufdr) - 10} 个话单")
            result.append("")

        if ufdr:
            result.append(f"**UFDR_* 系列 ({len(ufdr)}个)**：")
            result.append(", ".join(ufdr))
            result.append("")

        if tdr:
            result.append(f"**TDR_* 系列 ({len(tdr)}个)**：")
            result.append(", ".join(tdr))
            result.append("")

        return "\n".join(result)


def get_core_fields(record_name: str, manifest_path: str = None) -> str:
    """获取话单的核心字段列表

    Args:
        record_name: 话单名称
        manifest_path: 索引清单文件路径

    Returns:
        核心字段列表（Markdown格式）
    """
    searcher = DisSearcher(manifest_path)
    fields = searcher.get_fields_by_record(record_name)

    if not fields:
        return f"未找到话单: {record_name}"

    # 核心字段判断规则
    core_patterns = {
        "用户标识": ["IMSI", "MSISDN", "IMEI", "TMSI", "MTMSI", "GUTI", "OLD_TMSI"],
        "会话信息": ["SID", "REFID", "PROCEDURE_ID", "PROTOCOL_ID", "SESSIONKEY"],
        "时间信息": ["STARTTIME", "ENDTIME", "_TIME_SEC", "_TIME_MSEC", "PROC_"],
        "位置信息": ["MCC", "MNC", "RAT", "RAI", "TAI", "CGI", "ECGI", "LAC", "SAC", "RAC"],
        "网络信息": ["MME_ID", "ENB_ID", "SGW", "PGW", "SGW_SIGIP", "PGW_SIGIP", "_SIG_IP", "_NE_IP"],
        "成功标志": ["SUCCED_FLAG", "SUCCESS", "FAILED"],
        "APN信息": ["APN", "PDN_TYPE", "QCI", "ARP"],
        "原因值": ["CAUSE", "_REJ_", "_FAIL_"],
        "IP地址": ["_IP", "_IP2", "MS_IP", "UE_IP"]
    }

    # 分类字段
    categorized = {cat: [] for cat in core_patterns}
    other = []

    field_names = [f.get('数据库字段名', '') for f in fields]

    for field in fields:
        db_name = field.get('数据库字段名', '')
        matched = False

        for category, patterns in core_patterns.items():
            for pattern in patterns:
                if pattern.upper() in db_name.upper():
                    # 避免重复
                    if db_name not in [f['数据库字段名'] for f in categorized[category]]:
                        categorized[category].append(field)
                    matched = True
                    break
            if matched:
                break

        if not matched and len(other) < 10:
            other.append(field)

    # 生成输出
    result = [
        f"## {record_name} 核心字段",
        "",
        f"话单共有 **{len(fields)}** 个字段，以下为核心字段：",
        ""
    ]

    for category, cat_fields in categorized.items():
        if cat_fields:
            result.append(f"### {category}")
            result.append("")
            result.append("| 字段名 | 中文名 | 类型 | 说明 |")
            result.append("|--------|--------|------|------|")
            for f in cat_fields[:15]:  # 每类最多显示15个
                cn_name = f.get('字段中文名', '')
                f_type = f.get('字段类型', '')
                desc = f.get('字段含义', '')
                # 截断过长的描述
                if len(desc) > 40:
                    desc = desc[:40] + "..."
                result.append(f"| {f.get('数据库字段名', '')} | {cn_name} | {f_type} | {desc} |")
            result.append("")

    return "\n".join(result)


def get_field_count(record_name: str, manifest_path: str = None) -> dict:
    """获取话单字段数量

    Args:
        record_name: 话单名称
        manifest_path: 索引清单文件路径

    Returns:
        {"话单名称": str, "字段数": int, "字段列表": list}
    """
    searcher = DisSearcher(manifest_path)
    fields = searcher.get_fields_by_record(record_name)

    if not fields:
        # 尝试从records中获取
        records = searcher.index_data.get('records', {})
        if record_name in records:
            return {
                "话单名称": record_name,
                "字段数": records[record_name].get('字段数', 0),
                "字段列表": records[record_name].get('字段列表', [])
            }
        return None

    return {
        "话单名称": record_name,
        "字段数": len(fields),
        "字段列表": [f.get('数据库字段名', '') for f in fields]
    }


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  searcher.py stats [话单名称]     # 获取话单统计")
        print("  searcher.py core <话单名称>      # 获取核心字段")
        print("  searcher.py count <话单名称>     # 获取字段数量")
        print("  searcher.py <索引文件> <查询词>  # 搜索字段")
        sys.exit(1)

    # 获取默认索引路径
    skill_dir = Path(__file__).parent.parent
    default_index = skill_dir / "knowledge" / "index_manifest.json"

    cmd = sys.argv[1].lower()

    if cmd == "stats":
        record_name = sys.argv[2] if len(sys.argv) > 2 else None
        print(get_record_stats(record_name, str(default_index)))

    elif cmd == "core":
        if len(sys.argv) < 3:
            print("Usage: searcher.py core <话单名称>")
            sys.exit(1)
        print(get_core_fields(sys.argv[2], str(default_index)))

    elif cmd == "count":
        if len(sys.argv) < 3:
            print("Usage: searcher.py count <话单名称>")
            sys.exit(1)
        result = get_field_count(sys.argv[2], str(default_index))
        if result:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"未找到话单: {sys.argv[2]}")

    else:
        # 旧模式：searcher.py <索引文件> <查询词>
        index_path = sys.argv[1] if Path(sys.argv[1]).exists() else str(default_index)
        query = sys.argv[2] if len(sys.argv) > 2 else ""
        if not query:
            print("请提供查询关键词")
            sys.exit(1)
        result = search_dis(query, index_path)
        print(result)