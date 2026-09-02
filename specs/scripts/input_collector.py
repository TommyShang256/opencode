"""InputCollector - 用户输入收集模块

扫描文档中待填充的用户输入，提示用户，收集输入，刷新文档。
"""
import re
from pathlib import Path
from typing import List, Dict, Optional


class InputCollector:
    """用户输入收集器"""

    def __init__(self, document_path: str):
        self.document_path = Path(document_path)
        self.document_content = ""
        self._load()

    def _load(self):
        """加载文档"""
        if self.document_path.exists():
            self.document_content = self.document_path.read_text(encoding='utf-8')

    def reload(self):
        """重新加载文档"""
        self._load()

    def scan_pending(self) -> List[Dict]:
        """扫描待填充的用户输入

        Returns:
            待填充项列表，每项包含:
            - line_number: 行号
            - line_content: 行内容
            - field_name: 字段名（如果可以识别）
            - context: 上下文
        """
        if not self.document_content:
            return []

        lines = self.document_content.split('\n')
        pending = []

        for line_num, line in enumerate(lines, 1):
            if '[用户输入]' in line or '[用户提供]' in line or '待用户补充' in line:
                # 尝试提取字段名
                field_name = self._extract_field_name(line)

                # 获取上下文（前后各2行）
                start = max(0, line_num - 3)
                end = min(len(lines), line_num + 2)
                context = '\n'.join(lines[start:end])

                pending.append({
                    "line_number": line_num,
                    "line_content": line.strip(),
                    "field_name": field_name,
                    "context": context
                })

        return pending

    def _extract_field_name(self, line: str) -> Optional[str]:
        """从行内容中提取字段名"""
        # 模式1: - 字段名：[用户输入]
        match = re.search(r'-\s*([^：:]+?)[：:]\s*\[.*?\]', line)
        if match:
            return match.group(1).strip()

        # 模式2: ## 章节名
        match = re.search(r'(##+\s*[^\n]+)', line)
        if match:
            return match.group(1).strip()

        return None

    def format_prompt(self, pending_items: List[Dict]) -> str:
        """格式化提示信息

        Args:
            pending_items: 待填充项列表

        Returns:
            格式化的提示文本
        """
        if not pending_items:
            return ""

        lines = []
        lines.append("=" * 60)
        lines.append("Please supplement the following information:")
        lines.append("=" * 60)
        lines.append("")

        for idx, item in enumerate(pending_items, 1):
            field_name = item.get('field_name', 'Unknown')
            line_content = item.get('line_content', '')
            line_number = item.get('line_number', 0)

            lines.append(f"[{idx}] Line {line_number}")
            lines.append(f"    Field: {field_name}")
            lines.append(f"    Current: {line_content}")
            lines.append("")

        lines.append("=" * 60)
        lines.append("Reply with the information in JSON format:")
        lines.append('Example: {"字段1": "值1", "字段2": "值2"}')
        lines.append("=" * 60)

        return '\n'.join(lines)

    def refresh_document(self, user_inputs: Dict) -> bool:
        """刷新文档

        Args:
            user_inputs: 用户输入的键值对

        Returns:
            是否成功
        """
        if not self.document_content:
            return False

        refreshed = self.document_content

        for field_name, field_value in user_inputs.items():
            if not field_value:
                continue

            # 模式1: 样例数据 - 替换 [样例数据] 后面的内容
            if '样例数据' in field_name.lower() or field_name == '样例数据':
                pattern = r'(\[样例数据\])\s*\n'
                refreshed = re.sub(pattern, rf'\1\n{field_value}\n', refreshed)

            # 模式2: 目的 - 替换 "待用户补充"、"（可选，用户补充）" 等
            if '目的' in field_name:
                pattern = r'(## 1\. 目的\n.*?)(待用户补充|\[用户提供\]|\[用户输入\]|（可选，.*?）|（可选，用户补充）)'
                refreshed = re.sub(pattern, rf'\1{field_value}', refreshed)

            # 模式3: 替换所有 [用户输入] / [用户提供] / 待用户补充 / （可选，用户补充）
            # 找到字段名后面跟着这些标记的行
            patterns_to_replace = ['[用户输入]', '[用户提供]', '待用户补充', '（可选，用户补充）', '（可选，.*?）']
            for pattern_text in patterns_to_replace:
                # 模式：字段名.*标记
                pattern = rf'({re.escape(field_name)}[^\n]*?)\s*{re.escape(pattern_text)}'
                refreshed = re.sub(pattern, rf'\1{field_value}', refreshed)

            # 模式4: - 字段名：[用户输入]
            pattern4 = rf'-\s*{re.escape(field_name)}[：:]\s*\[.*?\]'
            refreshed = re.sub(pattern4, f"- {field_name}：{field_value}", refreshed)

        # 写回文件
        self.document_path.write_text(refreshed, encoding='utf-8')
        self.document_content = refreshed

        return True

    def parse_user_response(self, response: str, pending_items: List[Dict] = None) -> Dict:
        """解析用户回复

        Args:
            response: 用户回复内容
            pending_items: 待填充项列表

        Returns:
            解析出的键值对
        """
        import json

        user_inputs = {}

        # 尝试解析JSON格式
        try:
            user_inputs = json.loads(response)
            return user_inputs
        except json.JSONDecodeError:
            pass

        # 尝试解析键值对格式
        for line in response.strip().split('\n'):
            line = line.strip()
            if not line:
                continue

            # 尝试 键: 值 格式
            match = re.match(r'^([^：:]+?)[：:]\s*(.+)$', line)
            if match:
                key = match.group(1).strip()
                value = match.group(2).strip()
                user_inputs[key] = value
                continue

            # 尝试 键=值 格式
            match = re.match(r'^([^=]+?)=\s*(.+)$', line)
            if match:
                key = match.group(1).strip()
                value = match.group(2).strip()
                user_inputs[key] = value

        return user_inputs


def collect_user_inputs(document_path: str) -> tuple:
    """便捷函数：收集用户输入

    Returns:
        (pending_items, prompt_message)
    """
    collector = InputCollector(document_path)
    pending = collector.scan_pending()
    prompt = collector.format_prompt(pending)
    return pending, prompt


if __name__ == "__main__":
    # 测试
    import os
    doc_path = os.path.join(os.path.dirname(__file__), "..", "knowledge", "test.md")

    # 创建测试文档
    test_content = """# DIS XDR 数据集成需求

## 1. 目的
待用户补充

---

## 2. 样例数据
[用户提供]

## 4. 数据集成ETL信息

### 4.1 处理目标
TEST_RECORD
"""

    Path(doc_path).write_text(test_content, encoding='utf-8')

    collector = InputCollector(doc_path)

    # 扫描待填充项
    pending = collector.scan_pending()
    print("=== Pending Items ===")
    for p in pending:
        print(f"  Line {p['line_number']}: {p['field_name']} - {p['line_content']}")

    # 格式化提示
    prompt = collector.format_prompt(pending)
    print("\n=== Prompt Message ===")
    print(prompt)