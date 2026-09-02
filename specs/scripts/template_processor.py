"""TemplateProcessor - 模板处理模块

读取 Template.md，识别各类占位符，并关联所在章节。
参考 mae-unified-research 技能的设计。
"""
import re
from pathlib import Path
from typing import List
from enum import Enum


class PlaceholderType(Enum):
    """占位符类型"""
    AI_SPEC = "AI生成:规范"
    AI_USER_INPUT = "AI生成:用户输入"
    AI_MODEL = "AI生成:模型"
    USER_INPUT = "用户输入"
    AUTO_TIMESTAMP = "自动生成|时间戳"


class Placeholder:
    """占位符"""
    def __init__(self, type: PlaceholderType, raw: str, position: int):
        self.type = type
        self.raw = raw
        self.position = position
        # 提取子类型，如 "规范" -> 从 "[AI生成:规范]" 中提取
        self.sub_type = raw.replace('[AI生成:', '').replace(']', '') if type == PlaceholderType.AI_SPEC else ''
        # 节号，通过 analyze_placeholders 时从模板标题中提取，如 "3.1"
        self.section_num = ""


class TemplateProcessor:
    """模板处理器"""

    def __init__(self, template_file: str):
        self.template_file = Path(template_file)
        self.template_content = ""
        self.placeholders: List[Placeholder] = []
        self._load()

    def _load(self):
        """加载模板文件"""
        if self.template_file.exists():
            try:
                self.template_content = self.template_file.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                try:
                    self.template_content = self.template_file.read_text(encoding='gbk')
                except UnicodeDecodeError:
                    self.template_content = self.template_file.read_text(encoding='latin-1')

    def get_content(self) -> str:
        """获取模板内容"""
        return self.template_content

    def analyze_placeholders(self) -> List[Placeholder]:
        """分析模板中的所有占位符，并关联所在章节号"""
        self.placeholders = []

        # 收集所有占位符
        all_matches = []

        # AI生成:* 类型（匹配所有 [AI生成:xxx] 形式的占位符）
        for match in re.finditer(r'\[AI生成:([^\]]+)\]', self.template_content):
            sub_type = match.group(1)
            # 判断类型
            if sub_type == '用户输入':
                placeholder_type = PlaceholderType.AI_USER_INPUT
            elif sub_type == '模型':
                placeholder_type = PlaceholderType.AI_MODEL
            else:
                placeholder_type = PlaceholderType.AI_SPEC
            all_matches.append((placeholder_type, match.group(0), match.start()))

        # 用户输入
        for match in re.finditer(r'\[用户输入\]', self.template_content):
            all_matches.append((PlaceholderType.USER_INPUT, match.group(0), match.start()))

        # 自动时间戳
        for match in re.finditer(r'\[自动生成\|时间戳\]', self.template_content):
            all_matches.append((PlaceholderType.AUTO_TIMESTAMP, match.group(0), match.start()))

        # 按位置排序
        all_matches.sort(key=lambda m: m[2])

        # 构建章节索引（### 3.1 xxx 或 ### 4.1 xxx 形式）
        # 匹配三级标题，格式：### X.X 标题内容
        heading_regex = re.compile(r'^(#{2,3})\s+(\d+(?:\.\d+)*)\s+(.+)$', re.MULTILINE)
        heading_positions = []

        for match in heading_regex.finditer(self.template_content):
            level = len(match.group(1))  # 2=##, 3=###
            num = match.group(2)  # 如 "3.1"
            title = match.group(3).strip()
            heading_positions.append((match.start(), num, level, title))

        heading_positions.sort(key=lambda h: h[0])

        # 为每个占位符关联章节号
        for placeholder_type, raw, position in all_matches:
            # 提取sub_type
            sub_type = ''
            if raw.startswith('[AI生成:'):
                sub_type = raw.replace('[AI生成:', '').replace(']', '')

            placeholder = Placeholder(
                type=placeholder_type,
                raw=raw,
                position=position
            )
            placeholder.sub_type = sub_type

            # 找到该位置最近的前面章节标题
            current_section = ""
            for heading_pos, num, level, title in heading_positions:
                if heading_pos < position:
                    # 只使用三级标题（###）作为节号
                    if level == 3:
                        current_section = num
                else:
                    break

            placeholder.section_num = current_section
            self.placeholders.append(placeholder)

        return self.placeholders


def load_template(template_file: str) -> str:
    """便捷函数：加载模板"""
    processor = TemplateProcessor(template_file)
    return processor.get_content()


if __name__ == "__main__":
    import os
    template_file = os.path.join(os.path.dirname(__file__), "..", "references", "Template.md")
    processor = TemplateProcessor(template_file)
    placeholders = processor.analyze_placeholders()
    for p in placeholders:
        print(f"  [{p.section_num:>5}] {p.raw}")