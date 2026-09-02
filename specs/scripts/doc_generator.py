"""DocGenerator - 文档生成模块

将模板中的占位符替换为生成的内容，输出最终需求文档。
参考 mae-unified-research 技能的设计。
"""
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

from template_processor import TemplateProcessor, PlaceholderType
from ai_generator import AIGenerator
from spec_reader import SpecReader
from knowledge_retriever import KnowledgeRetriever


def normalize_field_name(name: str) -> str:
    """将字段名规范化为大写格式

    - 纯小写/数字：直接大写（如 timevalue -> TIMEVALUE）
    - 驼峰命名：转下划线后大写（如 RouteSetID -> ROUTE_SET_ID）
    """
    if not name:
        return name
    if any(c.isupper() for c in name):
        s1 = re.sub(r'(?<=[a-z])(?=[A-Z])', '_', name)
        return s1.upper()
    return name.upper()


def validate_field_description(text: str) -> str:
    """校验并清理字段说明，只保留允许的字符

    允许的字符集：
    - 中文（Unicode范围：\u4e00-\u9fff）
    - 英文字母（a-z, A-Z）
    - 希腊字母（α-ω, Α-Ω）
    - 数字（0-9）
    - 空格
    - 特殊符号：（）《》—；：、，。"''"_.;[]/:${}()!@#%^&*<>=+|~`,-℃\∞
    """
    if not text:
        return text

    # 构建允许字符集合（使用 set 提高查找效率）
    # 中文范围：\u4e00-\u9fff
    allowed_chars = set()
    # 添加中文字符
    for i in range(0x4e00, 0x9fff + 1):
        allowed_chars.add(chr(i))
    # 添加英文字母
    allowed_chars.update('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
    # 添加希腊字母（小写）
    allowed_chars.update('αβγδεζηθικλμνξοπρστυφχψω')
    # 添加希腊字母（大写）
    allowed_chars.update('ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ')
    # 添加数字
    allowed_chars.update('0123456789')
    # 添加空格
    allowed_chars.add(' ')
    # 添加特殊符号
    allowed_chars.update('()（）、《》—；：、，。""\'_.;[]/:${}()!@#%^&*<>=+|~`,-℃\\∞')

    # 过滤：只保留允许的字符
    filtered = ''.join(c for c in text if c in allowed_chars)
    return filtered


class DocGenerator:
    """需求文档生成器"""

    def __init__(self, template_file: str, spec_file: str, knowledge_dir: str = None):
        self.template_file = template_file
        self.spec_file = spec_file
        self.knowledge_dir = knowledge_dir

        self.template_processor = TemplateProcessor(template_file)
        self.spec_reader = SpecReader(spec_file) if spec_file else None
        self.knowledge_retriever = KnowledgeRetriever(knowledge_dir) if knowledge_dir else None
        self.ai_generator = AIGenerator(self.spec_reader, self.knowledge_retriever)

    def generate(self, subscription_name: str, subscription_info: Dict,
                 fields: List[Dict], user_inputs: Dict = None) -> str:
        """生成需求文档

        Args:
            subscription_name: 订阅名称
            subscription_info: 订阅配置信息
            fields: 字段列表（包含从知识库补全的详细信息）
            user_inputs: 用户补充的信息
        """
        user_inputs = user_inputs or {}

        # 构建上下文
        context = {
            'subscription_name': subscription_name,
            'subscription_info': subscription_info,
            'fields': fields,
            'user_inputs': user_inputs,
            'record_name': subscription_info.get('话单名称', subscription_name),
            'user_input_record_name': subscription_name,  # 用户原始输入的话单名称
            'delimiter': subscription_info.get('分隔符', '|'),
        }

        # ===字段 名规范化：将所有字段名转为大写格式 ===
        # 1. 处理 fields 列表中的字段名
        normalized_fields = []
        for f in fields:
            nf = dict(f)  # 浅拷贝，保留原始字段信息
            if '订阅字段名称' in nf:
                nf['订阅字段名称'] = normalize_field_name(nf['订阅字段名称'])
            if '数据库字段名' in nf:
                nf['数据库字段名'] = normalize_field_name(nf['数据库字段名'])
            # ===字段说明校验：过滤不允许的字符 ===
            for desc_field in ['字段说明', '字段含义', '字段中文名']:
                if desc_field in nf and nf[desc_field]:
                    nf[desc_field] = validate_field_description(nf[desc_field])
            normalized_fields.append(nf)
        context['fields'] = normalized_fields

        # 2. 处理 user_inputs 中的分区字段、排序列配置和数据转换规则
        if user_inputs:
            user_inputs = dict(user_inputs)  # 浅拷贝，避免修改原始数据
            # 分区字段
            if '分区字段' in user_inputs and user_inputs['分区字段']:
                user_inputs['分区字段'] = normalize_field_name(user_inputs['分区字段'])
            # 排序列配置（格式：字段名,顺序;字段名,顺序）
            if '排序列配置' in user_inputs and user_inputs['排序列配置']:
                sort_keys = user_inputs['排序列配置'].split(';')
                normalized_keys = []
                for key in sort_keys:
                    parts = key.strip().split(',')
                    if parts:
                        parts[0] = normalize_field_name(parts[0])
                    normalized_keys.append(','.join(parts))
                user_inputs['排序列配置'] = ';'.join(normalized_keys)
            # 数据转换规则中的新增字段
            if '数据转换规则' in user_inputs:
                transformation_rules = user_inputs.get('数据转换规则', '')
                if transformation_rules and transformation_rules.strip() not in ['跳过', '无', '没有', '否']:
                    user_input = transformation_rules.strip()
                    if '|' in user_input:
                        # 表格格式：| 输出字段 | 字段类型 | 字段说明 | 转换类型 | 计算公式 |
                        lines = user_input.split('\n')
                        normalized_lines = []
                        for line in lines:
                            if '|' in line and line.strip():
                                parts = [p.strip() for p in line.split('|')]
                                if len(parts) >= 5 and parts[1].strip():
                                    # 第一个单元格是输出字段名，需要规范化
                                    parts[1] = normalize_field_name(parts[1])
                                normalized_lines.append('|'.join(parts))
                            else:
                                normalized_lines.append(line)
                        user_inputs['数据转换规则'] = '\n'.join(normalized_lines)
                    else:
                        # 字段名列表格式：field1,field2,field3
                        field_names = [f.strip() for f in transformation_rules.replace('、', ',').split(',') if f.strip()]
                        normalized_names = [normalize_field_name(name) for name in field_names]
                        user_inputs['数据转换规则'] = ','.join(normalized_names)
            context['user_inputs'] = user_inputs

        # 解析模板
        self.template_processor.analyze_placeholders()

        # 初始内容
        content = self.template_processor.get_content()

        # 用于跟踪已处理的占位符（使用唯一标记避免重复替换）
        processed_markers = set()

        for placeholder in self.template_processor.placeholders:
            # 为每个占位符创建唯一标记
            marker = f"__PH_{placeholder.position}_{placeholder.raw}__"

            # 如果已处理过，跳过
            if marker in processed_markers:
                continue

            # 生成内容
            generated = self.ai_generator.generate(placeholder, context)

            # 使用两步替换避免嵌套问题
            content = content.replace(placeholder.raw, marker, 1)
            content = content.replace(marker, generated, 1)

            processed_markers.add(marker)

        return content

    def save_to_desktop(self, content: str, subscription_name: str) -> str:
        """保存文档到工作区的output目录

        同时生成 Markdown 和 Word 两种格式。
        如果 DIS_SKIP_DOCX=1 环境变量设置，则跳过 Word 文档生成（用于内存不足时）。
        """
        from datetime import datetime
        # 时间戳格式: YYYYMMDDHHMM (如 202607171132)
        timestamp_str = datetime.now().strftime("%Y%m%d%H%M")
        file_name = f"DIS_Integration_{subscription_name}_{timestamp_str}.md"

        # 优先使用环境变量指定的工作区目录
        # 支持 DAAGENT_WORKSPACE 或 CLAUDE_WORKSPACE 环境变量
        workspace_env = os.environ.get('DAAGENT_WORKSPACE') or os.environ.get('CLAUDE_WORKSPACE')

        # 检查是否跳过 Word 文档生成（内存不足时可设置 DIS_SKIP_DOCX=1）
        skip_docx = os.environ.get('DIS_SKIP_DOCX', '0') == '1'

        if workspace_env:
            output_dir = Path(workspace_env) / "output"
        else:
            # 默认使用 ~/.daagent/workspaces/default/output
            output_dir = Path.home() / ".daagent" / "workspaces" / "default" / "output"

        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / file_name
        output_path.write_text(content, encoding='utf-8')

        # 自动转换为 Word 格式
        # 如果 Word 生成失败（如内存不足），只保留 Markdown 文档
        # 设置 DIS_SKIP_DOCX=1 可跳过 Word 文档生成
        if not skip_docx:
            try:
                from doc_converter import convert_doc
                docx_path = convert_doc(str(output_path))
                print(f"  [OK] Word document generated: {docx_path}")
            except MemoryError as e:
                print(f"  [WARN] Word conversion skipped due to insufficient memory")
                print(f"  [INFO] Markdown document is still available: {output_path}")
                print(f"  [TIP] Set DIS_SKIP_DOCX=1 to skip Word generation")
            except Exception as e:
                print(f"  [WARN] Word conversion failed: {e}")
                print(f"  [INFO] Markdown document is still available: {output_path}")

        return str(output_path)

    def count_pending(self, content: str) -> int:
        """统计文档中待填充的用户输入数量"""
        count = 0
        for line in content.split('\n'):
            if '[用户输入]' in line or '[用户提供]' in line or '待用户补充' in line:
                count += 1
        return count


def generate_document(template_file: str, spec_file: str,
                     subscription_name: str, subscription_info: Dict,
                     fields: List[Dict], user_inputs: Dict = None) -> str:
    """便捷函数：生成需求文档"""
    generator = DocGenerator(template_file, spec_file)
    return generator.generate(subscription_name, subscription_info, fields, user_inputs)