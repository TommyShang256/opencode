"""SpecReader - 规范读取模块

读取 Dis_Integration_Specification.md，获取指定章节内容。
参考 mae-unified-research 技能的设计。
"""
import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Any


class SpecReader:
    """规范文件读取器"""

    def __init__(self, spec_file: str):
        self.spec_file = Path(spec_file)
        self.spec_content = ""
        self._load()

    def _load(self):
        """加载规范文件"""
        if self.spec_file.exists():
            try:
                self.spec_content = self.spec_file.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    self.spec_content = self.spec_file.read_text(encoding='gbk')
                except UnicodeDecodeError:
                    self.spec_content = self.spec_file.read_text(encoding='latin-1')

    def get_full_spec(self) -> str:
        """获取完整规范内容"""
        return self.spec_content

    def get_section(self, section_name: str) -> str:
        """获取指定章节的内容

        Args:
            section_name: 章节名称，支持：
                - 序号形式：如 "1.1"、"2.3"（匹配 ### 1.1 开头的章节）
                - 精确匹配：如 "处理目标"

        Returns:
            章节内容，如果未找到返回空字符串
        """
        if not self.spec_content:
            return ""

        lines = self.spec_content.split('\n')

        # 判断是否为序号形式（如 "1.1"、"2.3"）
        is_serial = bool(re.match(r'^\d+(\.\d+)+$', section_name))

        start_idx = -1
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped.startswith('###'):
                title = stripped[3:].strip()
                if is_serial:
                    # 匹配序号开头：### 1.1 处理目标
                    if re.match(rf'^{re.escape(section_name)}\s', title):
                        start_idx = i
                        break
                else:
                    if title == section_name:
                        start_idx = i
                        break
            elif stripped.startswith('##') and not is_serial:
                title = stripped[2:].strip()
                if title == section_name:
                    start_idx = i
                    break

        if start_idx == -1:
            return ""

        # 收集章节内容
        # 停止条件：遇到带序号的三级标题（### X.X），这表示同级的新章节
        section_lines = []
        for i in range(start_idx + 1, len(lines)):
            line = lines[i]
            stripped = line.strip()

            # 遇到一级标题（## 开头）就停止
            if stripped.startswith('## '):
                break

            # 遇到同级的三级标题（### X.X 形式）也停止（不要跨章节收集）
            if stripped.startswith('### ') and re.match(r'^### \d+\.\d+\s', stripped):
                break

            section_lines.append(line)

        result = '\n'.join(section_lines).strip()

        # 去除结尾的分隔符 ---
        while result.endswith('---'):
            result = result[:-3].strip()

        return result

    def extract_table_config(self, section_name: str, config_title: str = "新增字段") -> List[Dict[str, Any]]:
        """从指定章节中提取表格形式的配置

        支持解析规范中的 Markdown 表格，转换为标准配置列表。
        表格格式：
        | 输出字段 | 字段类型 | 字段说明 | 转换类型 | 计算公式 | 条件（话单名称） |

        算法：
        1. 找到包含 config_title 的行作为锚点（标记区块开始）
        2. 从锚点往后，找第一个有效的 Markdown 表头行（| col1 | col2 | ... 且第二列不是 ---）
        3. 解析表头列名，然后逐行解析数据行

        Args:
            section_name: 章节名称，如 "2.3"
            config_title: 配置表格的标题关键词，如 "新增字段"

        Returns:
            配置列表，每个元素是一个字段配置字典
        """
        section_content = self.get_section(section_name)
        if not section_content:
            return []

        lines = section_content.split('\n')

        # Step 1: 找到锚点行（包含关键词的那一行）
        anchor_idx = -1
        for i, line in enumerate(lines):
            if config_title in line.strip():
                anchor_idx = i
                break

        if anchor_idx == -1:
            return []

        # Step 2: 从锚点往后，找第一个有效的表头行
        # 有效的表头行特征：有 | 分隔符，第二列不是 ---（不是分隔行）
        header_idx = -1
        for i in range(anchor_idx, len(lines)):
            stripped = lines[i].strip()
            if not stripped.startswith('|'):
                continue
            # 检查第二列是否是 separator（ --- ）
            parts = stripped.split('|')
            if len(parts) >= 3:
                second_col = parts[2].strip()
                if second_col and second_col != '---':
                    header_idx = i
                    break

        if header_idx == -1:
            return []

        # Step 3: 解析表头列名
        header_parts = lines[header_idx].strip().split('|')
        header_cols = [c.strip() for c in header_parts if c.strip()]
        header_count = len(header_cols)

        # Step 4: 从表头下一行开始，逐行解析数据
        configs = []
        for i in range(header_idx + 1, len(lines)):
            data_line = lines[i].strip()
            # 跳过 separator 行
            if '---' in data_line:
                continue
            # 遇到非表格行，结束
            if not data_line.startswith('|'):
                break
            # 解析数据行：分割，过滤首尾空白，补齐/截断到表头长度
            raw_parts = data_line.split('|')
            data_parts = [c.strip() for c in raw_parts if c.strip()]
            # 与表头对齐
            if len(data_parts) < header_count:
                data_parts += [''] * (header_count - len(data_parts))
            else:
                data_parts = data_parts[:header_count]
            row_dict = dict(zip(header_cols, data_parts))
            configs.append(row_dict)

        return configs

    def extract_json_config(self, section_name: str, config_key: str) -> List[Dict[str, Any]]:
        """从指定章节中提取JSON配置块（兼容旧版）

        支持解析规范中嵌入的机器可读JSON配置，实现动态规则。

        Args:
            section_name: 章节名称，如 "2.3"
            config_key: 配置键名，如 "新增字段"

        Returns:
            配置列表，每个元素是一个字段配置字典
        """
        section_content = self.get_section(section_name)
        if not section_content:
            return []

        # 匹配 JSON 代码块（在 ```json 和 ``` 之间）
        json_pattern = r'```json\s*(.*?)\s*```'
        matches = re.findall(json_pattern, section_content, re.DOTALL)

        for match in matches:
            try:
                data = json.loads(match)
                if config_key in data:
                    config_list = data[config_key]
                    if isinstance(config_list, list):
                        return config_list
            except json.JSONDecodeError:
                continue

        return []

    def get_derived_fields(self, section_name: str = "2.3", config_title: str = "新增字段") -> List[Dict[str, Any]]:
        """获取派生字段配置（便捷方法）

        优先从表格配置中提取，若无则回退到 JSON 配置。

        Args:
            section_name: 章节名称，默认 "2.3"（数据转换）
            config_title: 配置表格的标题关键词，默认 "新增字段"

        Returns:
            派生字段配置列表
        """
        # 优先尝试表格格式
        table_configs = self.extract_table_config(section_name, config_title)
        if table_configs:
            return table_configs

        # 回退到 JSON 格式
        return self.extract_json_config(section_name, config_title)

    def match_condition(self, condition: Any, context: Dict[str, Any]) -> bool:
        """判断条件是否匹配

        支持两种条件格式：
        1. 表格格式（字符串）："DETAIL_DIS_THROUGHPUT" 或 ""
        2. JSON格式（字典）：{"话单名称": "DETAIL_DIS_THROUGHPUT"}

        Args:
            condition: 条件值，空字符串/None 表示无条件匹配
            context: 上下文，包含 record_name 等信息

        Returns:
            True 如果条件匹配或不限制条件
        """
        # 空值、无条件
        if condition is None or condition == "":
            return True

        record_name = context.get('record_name', '')

        # 表格格式：直接是字符串值（如 "DETAIL_DIS_THROUGHPUT"）
        if isinstance(condition, str):
            return record_name == condition

        # JSON格式：字典 {"话单名称": "XXX"}
        if isinstance(condition, dict):
            for key, value in condition.items():
                # 尝试匹配话单名称
                context_value = context.get(key) or context.get('record_name', '')
                if str(context_value) != str(value):
                    return False

        return True


def read_specification(spec_file: str) -> str:
    """便捷函数"""
    reader = SpecReader(spec_file)
    return reader.get_full_spec()