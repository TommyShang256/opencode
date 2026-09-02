"""AIGenerator - AI动态生成模块

根据占位符类型和章节号生成内容。
参考 mae-unified-research 技能的设计。

占位符格式：[AI生成:XXX]，XXX即为规范中的章节标识
章节映射：Template 3.x -> Spec 1.x (数据集成ETL)
          Template 4.x -> Spec 2.x (数据处理ETL)

【核心特性】内容从规范动态读取
- 规范文档定义数据转换规则
- 代码通过 SpecReader 自动解析规范
- 修改规范即可调整输出内容
"""
from typing import Dict, List, Any, Optional
from datetime import datetime


# 模板章节与规范章节的映射关系
# Template 3.x -> Spec 1.x (数据计算ETL)
# Template 4.x -> Spec 2.x (物理模型)
SECTION_MAPPING = {
    '3': '1',
    '4': '2',
}


# 派生字段配置（当规范文档中无配置时使用）
DERIVED_FIELDS_CONFIG = []


class AIGenerator:
    """AI内容生成器"""

    def __init__(self, spec_reader=None, knowledge_retriever=None):
        self.spec_reader = spec_reader
        self.knowledge_retriever = knowledge_retriever

    def generate(self, placeholder: Any, context: Dict) -> str:
        """根据占位符生成内容

        Args:
            placeholder: Placeholder对象或其raw字符串
            context: 上下文字典，包含 record_name, fields, subscription_info 等
        """
        # 支持两种调用方式
        if hasattr(placeholder, 'raw'):
            placeholder_raw = placeholder.raw
            section_num = getattr(placeholder, 'section_num', '')
            sub_type = getattr(placeholder, 'sub_type', '')
        else:
            placeholder_raw = placeholder
            section_num = context.get('_section_num', '')
            sub_type = ''

        # 根据占位符类型生成
        if placeholder_raw.startswith("[AI生成:"):
            return self._generate_by_sub_type(sub_type, context, section_num)
        elif placeholder_raw == "[用户输入]":
            return "[用户输入]"
        elif placeholder_raw.startswith("[自动生成"):
            return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        else:
            return placeholder_raw

    def _generate_by_sub_type(self, sub_type: str, context: Dict, section_num: str = "") -> str:
        """根据子类型生成内容

        Args:
            sub_type: 子类型（如 "规范"）
            context: 上下文字典
            section_num: 节号（如 "3.1"、"4.2"）
        """
        record_name = context.get('record_name', '')
        fields = context.get('fields', [])
        subscription_info = context.get('subscription_info', {})
        user_inputs = context.get('user_inputs', {})

        # 用户输入推断 - 生成目的描述
        if sub_type == "用户输入":
            # 优先使用用户原始输入的名称，如果没有则使用完整话单名称
            user_input_name = context.get('user_input_record_name', record_name)
            return f"DIS XDR话单{user_input_name}的数据集成需求，用于后续数据分析与应用"

        # 物理模型 - 处理三种存储模型
        if sub_type == "SFTP模型":
            return self._generate_sftp_model_content(context)
        if sub_type == "Kafka模型":
            return self._generate_kafka_model_content(context)
        if sub_type == "ClickHouse模型":
            return self._generate_model_content(context)

        # 从规范文档读取
        if sub_type == "规范" or not sub_type:
            mapped = self._map_section_num(section_num) if section_num else ""
            if self.spec_reader and mapped:
                content = self.spec_reader.get_section(mapped)
                if content:
                    # 获取模型名称（支持覆盖）
                    user_inputs = context.get('user_inputs', {})
                    model_overrides = user_inputs.get('_model_overrides', {})

                    # 根据规范章节号选择对应的模型名称
                    # 规范 1.x = 数据计算ETL（来源->Kafka，存储->ClickHouse）
                    # 规范 2.x = 物理模型（2.1=Kafka, 2.2=ClickHouse）
                    mapped_prefix = mapped.split('.')[0] if mapped else ''

                    if mapped_prefix == '1':
                        # 数据计算ETL
                        # 1.1 处理目标、1.2 数据来源 -> 使用 Kafka 模型
                        # 1.3 数据转换、1.4 数据存储 -> 使用 ClickHouse 模型
                        if mapped in ['1.1', '1.2']:
                            model_name = model_overrides.get('kafka', record_name)
                        else:
                            model_name = model_overrides.get('clickhouse', record_name)
                    elif mapped == '2.1':
                        # Kafka 模型
                        model_name = model_overrides.get('kafka', record_name)
                    elif mapped == '2.2':
                        # ClickHouse 模型
                        model_name = model_overrides.get('clickhouse', record_name)
                    else:
                        # 其他章节使用话单名称
                        model_name = record_name

                    # 替换变量
                    content = content.replace('<话单名称>', model_name)
                    content = content.replace('<订阅名称>', context.get('subscription_name', record_name))

                    # 处理 1.2 数据源的动态字段列表
                    if mapped == '1.2':
                        content = self._inject_output_fields(content, fields)

                    # 处理 1.2 数据来源的字段类型
                    if mapped == '1.2':
                        content = self._inject_source_fields(content, fields)

                    # 处理 1.3 数据转换：注入用户输入的转换规则（仅数据计算ETL）
                    if mapped == '1.3':
                        content = self._inject_transformation_rules(content, user_inputs)

                    # 处理物理模型章节：注入字段列表和分区配置
                    if mapped == '2.1':
                        # Kafka模型
                        content = content.replace('<话单名称>', model_name)
                        content = self._inject_kafka_fields(content, fields, user_inputs)
                    elif mapped == '2.2':
                        # ClickHouse模型
                        content = content.replace('<话单名称>', model_name)
                        content = self._inject_model_fields(content, fields, model_name, user_inputs)

                    return content

        return "[规范内容]"

    def _map_section_num(self, template_section: str) -> str:
        """将模板章节号映射到规范章节号

        特殊映射：
        - 模板 4.1 (Kafka模型) -> 规范 2.1
        - 模板 4.2 (ClickHouse模型) -> 规范 2.2
        """
        # 特殊章节映射
        special_mapping = {
            '4.1': '2.1',  # Kafka模型
            '4.2': '2.2',  # ClickHouse模型
        }
        if template_section in special_mapping:
            return special_mapping[template_section]

        # 前缀映射：3.x -> 1.x
        parts = template_section.split('.')
        if parts and parts[0] in SECTION_MAPPING:
            parts[0] = SECTION_MAPPING[parts[0]]
            return '.'.join(parts)
        return template_section

    def _inject_output_fields(self, content: str, fields: List[Dict]) -> str:
        """为数据源章节注入输出字段列表

        Args:
            content: 原始内容
            fields: 字段列表

        Returns:
            替换后的内容
        """
        if not fields:
            return content.replace('[动态输出字段列表]', '| （暂无字段数据） |')

        # 生成字段列表表格
        lines = []
        lines.append("")
        lines.append("| 字段名称 | 字段类型 |")
        lines.append("|----------|----------|")
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            if fname:
                lines.append(f"| {fname} | String |")

        content = content.replace('[动态输出字段列表]', '\n'.join(lines))
        return content

    def _inject_source_fields(self, content: str, fields: List[Dict]) -> str:
        """为数据来源章节注入字段类型映射

        Args:
            content: 原始内容
            fields: 字段列表

        Returns:
            替换后的内容
        """
        if not fields:
            return content

        # 生成字段类型映射表格
        lines = []
        lines.append("")
        lines.append("| 字段名称 | 字段类型 |")
        lines.append("|----------|----------|")
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            ftype = f.get('字段类型', 'String')
            # 简化类型
            ch_type = self._simplify_type(ftype)
            if fname:
                lines.append(f"| {fname} | {ch_type} |")

        content = content.replace('[动态字段类型映射]', '\n'.join(lines))
        return content

    def _inject_transformation_rules(self, content: str, user_inputs: Dict) -> str:
        """为数据转换章节注入转换规则

        从规范文档 1.3 章节读取新增字段配置，并合并用户输入的转换规则。

        Args:
            content: 原始内容（从规范文档读取）
            user_inputs: 用户输入（包含分区字段、排序列配置等）

        Returns:
            替换后的内容
        """
        user_inputs = user_inputs or {}

        # 从规范文档 1.3 章节读取新增字段配置
        derived_fields = []
        if self.spec_reader:
            derived_fields = self.spec_reader.get_derived_fields("1.3", "新增字段")

        # 检查用户输入的转换规则
        transformation_rules = user_inputs.get('数据转换规则', '')
        user_skip = transformation_rules and transformation_rules.strip() in ['跳过', '无', '没有', '否']

        # 收集需要添加的字段
        new_fields = []

        # 添加规范中的默认新增字段
        for field in derived_fields:
            new_fields.append(field)

        # 添加用户输入的字段（去重）
        if transformation_rules and not user_skip:
            user_input = transformation_rules.strip()

            if '|' in user_input:
                # 用户输入的是表格格式
                lines = [l.strip() for l in user_input.split('\n') if l.strip() and '|' in l]
                for line in lines:
                    parts = [p.strip() for p in line.split('|') if p.strip()]
                    if len(parts) >= 5:
                        field_name = parts[0]
                        # 去重检查
                        if not any(f.get('输出字段') == field_name for f in new_fields):
                            new_fields.append({
                                '输出字段': field_name,
                                '字段类型': parts[1],
                                '字段说明': parts[2],
                                '转换类型': parts[3],
                                '计算公式': parts[4]
                            })
            else:
                # 用户输入的是字段名列表
                field_names = [f.strip() for f in transformation_rules.replace('、', ',').split(',') if f.strip()]
                for field_name in field_names:
                    # 去重检查
                    if not any(f.get('输出字段') == field_name for f in new_fields):
                        if field_name == 'INSERT_TIME':
                            new_fields.append({
                                '输出字段': 'INSERT_TIME',
                                '字段类型': 'STRING',
                                '字段说明': '数据入库时间',
                                '转换类型': '表达式计算',
                                '计算公式': '通过计算当前时间转为年月日格式（yyyy-MM-dd）得到'
                            })
                        else:
                            new_fields.append({
                                '输出字段': field_name,
                                '字段类型': 'STRING',
                                '字段说明': '(用户自定义新增字段)',
                                '转换类型': '原有字段输出',
                                '计算公式': '直接输出（新增字段，值为空或默认值）'
                            })

        # 如果没有转换规则也没有规范字段，添加默认的INSERT_TIME
        if not new_fields:
            new_fields.append({
                '输出字段': 'INSERT_TIME',
                '字段类型': 'STRING',
                '字段说明': '数据入库时间',
                '转换类型': '表达式计算',
                '计算公式': '通过计算当前时间转为年月日格式（yyyy-MM-dd）得到'
            })

        # 生成转换规则表格
        rule_lines = []
        for f in new_fields:
            rule_lines.append(f"| {f.get('输出字段', '')} | {f.get('字段类型', '')} | "
                            f"{f.get('字段说明', '')} | {f.get('转换类型', '')} | "
                            f"{f.get('计算公式', '')} |")

        new_table = '\n\n**新增字段**：\n\n'
        new_table += '| 输出字段 | 字段类型 | 字段说明 | 转换类型 | 计算公式 |\n'
        new_table += '| -------- | -------- | -------- | -------- | -------- |\n'
        new_table += '\n'.join(rule_lines)

        # 查找 **新增字段**： 的位置，删除旧的表格
        marker = '**新增字段**：'
        marker_pos = content.find(marker)
        if marker_pos != -1:
            # 找到表格结束位置（下一个空行或章节分隔符）
            end_pos = content.find('\n\n', marker_pos)
            if end_pos == -1:
                end_pos = len(content)
            # 替换旧表格为新表格
            content = content[:marker_pos] + new_table + content[end_pos:]
        else:
            # 如果没有找到 marker，直接追加表格
            content += new_table

        return content

    def _simplify_type(self, field_type: str) -> str:
        """简化字段类型为ClickHouse类型"""
        field_type = field_type.upper()
        if 'VARCHAR' in field_type or 'VARCAHR' in field_type:
            return 'String'
        elif 'NUMERIC' in field_type or 'NUMBRIC' in field_type:
            return 'String'  # 时间戳等数字类型在Kafka中存储为String
        elif 'INT' in field_type:
            return 'Int64'
        else:
            return 'String'

    def _generate_sftp_model_content(self, context: Dict) -> str:
        """生成 SFTP 物理模型内容

        从规范文档 3.1 节读取 SFTP 模型信息，注入订阅字段列表。
        """
        if self.spec_reader:
            content = self.spec_reader.get_section('3.1')
            if content:
                # 获取模型名称（支持覆盖）
                record_name = context.get('record_name', '')
                user_inputs = context.get('user_inputs', {})
                model_overrides = user_inputs.get('_model_overrides', {})
                model_name = model_overrides.get('sftp', record_name)

                content = content.replace('<话单名称>', model_name)

                fields = context.get('fields', [])
                user_inputs = context.get('user_inputs', {})
                return self._inject_sftp_fields(content, fields, user_inputs)
        return "| 字段名 | 字段类型 | 说明 |\n|--------|---------|------|\n| （暂无字段数据） | - | - |"

    def _inject_sftp_fields(self, content: str, fields: List[Dict], user_inputs: Dict = None) -> str:
        """为 SFTP 模型注入字段列表，支持用户覆盖字段类型"""
        user_inputs = user_inputs or {}

        # 解析用户输入的字段类型映射
        field_type_overrides = self._parse_field_type_overrides(user_inputs.get('字段类型映射', ''))

        if not fields:
            return content

        field_lines = []
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            # 使用统一的类型获取方法，优先用户覆盖
            ftype = self._get_field_type(f, field_type_overrides)
            # 优先使用字段说明，其次是字段中文名和字段含义
            fdesc = f.get('字段说明', f.get('字段含义', f.get('字段中文名', '')))

            if fname:
                field_lines.append(f"| {fname} | {ftype} | {fdesc} |")

        if field_lines:
            content = content.replace('[订阅字段名称-SFTP]', '\n'.join(field_lines))

        return content

    def _generate_kafka_model_content(self, context: Dict) -> str:
        """生成 Kafka 物理模型内容

        从规范文档 2.1 节读取 Kafka 模型信息，注入订阅字段列表。
        """
        if self.spec_reader:
            content = self.spec_reader.get_section('2.1')
            if content:
                # 获取模型名称（支持覆盖）
                record_name = context.get('record_name', '')
                user_inputs = context.get('user_inputs', {})
                model_overrides = user_inputs.get('_model_overrides', {})
                model_name = model_overrides.get('kafka', record_name)

                content = content.replace('<话单名称>', model_name)

                fields = context.get('fields', [])
                user_inputs = context.get('user_inputs', {})
                return self._inject_kafka_fields(content, fields, user_inputs)
        return "| 字段名 | 字段类型 | 说明 |\n|--------|---------|------|\n| （暂无字段数据） | - | - |"

    def _inject_kafka_fields(self, content: str, fields: List[Dict], user_inputs: Dict = None) -> str:
        """为 Kafka 模型注入字段列表

        使用数据字典中的字段类型_DB作为数据类型，支持用户覆盖。
        """
        user_inputs = user_inputs or {}

        # 解析用户输入的字段类型映射
        field_type_overrides = self._parse_field_type_overrides(user_inputs.get('字段类型映射', ''))

        if not fields:
            return content

        field_lines = []
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            # 使用统一的类型获取方法，优先用户覆盖
            ftype = self._get_field_type(f, field_type_overrides)
            # 优先使用字段说明，其次是字段中文名和字段含义
            fdesc = f.get('字段说明', f.get('字段含义', f.get('字段中文名', '')))

            if fname:
                field_lines.append(f"| {fname} | {ftype} | {fdesc} |")

        if field_lines:
            content = content.replace('[用户输入字段名称-Kafka]', '\n'.join(field_lines))

        return content

    def _generate_model_content(self, context: Dict) -> str:
        """生成物理模型内容

        从规范文档 2.2 节读取 ClickHouse 模型信息，注入订阅字段列表。
        """
        user_inputs = context.get('user_inputs', {})
        model_overrides = user_inputs.get('_model_overrides', {})

        if self.spec_reader:
            content = self.spec_reader.get_section('2.2')
            if content:
                # 替换话单名称占位符（支持模型名称覆盖）
                record_name = context.get('record_name', '')
                model_name = model_overrides.get('clickhouse', record_name)
                content = content.replace('<话单名称>', model_name)

                fields = context.get('fields', [])
                return self._inject_model_fields(content, fields, model_name, user_inputs)

        # 回退：如果无法读取规范，使用旧版逻辑
        record_name = context.get('record_name', '')
        model_name = model_overrides.get('clickhouse', record_name)
        fields = context.get('fields', [])

        if not fields:
            return "| 字段名 | 字段类型 | 说明 |\n|--------|---------|------|\n| （暂无字段数据） | - | - |"

        lines = []
        lines.append("### 3.3 ClickHouse模型")
        lines.append("**建模逻辑**")
        lines.append(f"- 模型名称：{record_name}")
        lines.append("- 数据源：gde-ude-clickhouse-cluster")
        lines.append(f"- 数据库表名称：{record_name}")
        lines.append("")

        # 生成字段表格
        lines.append("| 字段名 | 字段类型 | 说明 |")
        lines.append("|--------|---------|------|")

        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            ftype = f.get('字段类型', '')
            # 优先使用字段说明，其次是字段中文名和字段含义
            fdesc = f.get('字段说明', f.get('字段含义', f.get('字段中文名', '')))

            if fname:
                lines.append(f"| {fname} | {ftype} | {fdesc} |")

        return '\n'.join(lines)

    def _inject_model_fields(self, content: str, fields: List[Dict], record_name: str, user_inputs: Dict = None) -> str:
        """为 ClickHouse 模型注入字段列表

        Args:
            content: 原始内容
            fields: 字段列表
            record_name: 话单名称
            user_inputs: 用户输入（包含分区字段、排序列配置、字段类型映射等）
        """
        user_inputs = user_inputs or {}

        # 解析用户输入的字段类型映射
        field_type_overrides = self._parse_field_type_overrides(user_inputs.get('字段类型映射', ''))

        if not fields:
            return content

        # 收集原有字段名（用于去重）
        existing_field_names = set()
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            if fname:
                existing_field_names.add(fname.upper())

        # 生成字段表格行
        field_lines = []
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            # 使用统一的类型获取方法，优先用户覆盖
            ftype = self._get_field_type(f, field_type_overrides)
            # 优先使用字段说明，其次是字段中文名和字段含义
            fdesc = f.get('字段说明', f.get('字段含义', f.get('字段中文名', '')))

            if fname:
                field_lines.append(f"| {fname} | {ftype} | {fdesc} |")

        # 从规范文档 1.3 章节读取新增字段配置
        if self.spec_reader:
            spec_content = self.spec_reader.get_section('1.3')
            if spec_content and '新增字段' in spec_content:
                # 解析新增字段表格
                derived_fields = self.spec_reader.get_derived_fields("1.3", "新增字段")
                for field in derived_fields:
                    field_name = field.get('输出字段', '')
                    if field_name and field_name.upper() not in existing_field_names:
                        field_type = field.get('字段类型', 'String')
                        field_desc = field.get('字段说明', '')
                        field_lines.append(f"| {field_name} | {field_type} | {field_desc} |")
                        existing_field_names.add(field_name.upper())

        # 添加用户输入的转换规则中的新增字段（去重）
        transformation_rules = user_inputs.get('数据转换规则', '')
        if transformation_rules and transformation_rules.strip() and transformation_rules.strip() not in ['跳过', '无', '没有', '否']:
            # 解析字段名列表
            field_names = [f.strip() for f in transformation_rules.replace('、', ',').split(',') if f.strip()]
            for field_name in field_names:
                # 只添加不在原有字段列表中的字段
                if field_name.upper() not in existing_field_names:
                    if field_name == 'INSERT_TIME':
                        field_lines.append(f"| {field_name} | String | 数据入库时间 |")
                    else:
                        field_lines.append(f"| {field_name} | String | - |")

        # 先确定分区字段和排序列（AI推荐或用户输入）
        partition_field = user_inputs.get('分区字段', '')
        sort_key_config = user_inputs.get('排序列配置', '')

        # 如果分区字段不在原有字段列表中，自动添加到字段列表
        if partition_field and partition_field.upper() not in existing_field_names:
            field_lines.append(f"| {partition_field} | String | 分区字段（自动添加） |")
            existing_field_names.add(partition_field.upper())

        # 如果排序列字段不在原有字段列表中，自动添加到字段列表
        if sort_key_config:
            import re
            # 排序列配置格式: "| 输出字段 | 排序列顺序 |\n| -------- | ---------- |\n| TIME | 1 |"
            # 需要匹配最后一行（实际数据行），而不是表头行
            matches = re.findall(r'\|\s*(\w+)\s*\|', sort_key_config)
            if matches:
                sort_field = matches[-1]  # 取最后一个匹配（实际数据行）
                if sort_field.upper() not in existing_field_names:
                    field_lines.append(f"| {sort_field} | String | 排序列字段（自动添加） |")
                    existing_field_names.add(sort_field.upper())

        # 替换占位符
        content = content.replace('[用户输入字段名称-ClickHouse]', '\n'.join(field_lines))

        # 替换分区字段
        if partition_field:
            content = content.replace('[分区字段]', partition_field)
        # 如果没有用户输入，[分区字段] 保持原样

        # 替换排序列配置
        if sort_key_config:
            content = content.replace('[排序列配置]', sort_key_config)
        else:
            # 如果用户没有配置排序列，移除占位符
            content = content.replace('[排序列配置]', '（无排序列配置）')

        return content

    def _detect_time_field(self, fields: List[Dict]) -> str:
        """从字段列表中自动识别开始时间字段

        优先级：START_TIME > BEGIN_TIME > RECORD_TIME > 第一条时间类型字段
        """
        time_field_priority = ['START_TIME', 'BEGIN_TIME', 'RECORD_TIME', 'CALL_START_TIME',
                               'END_TIME', 'CALL_END_TIME', 'TIME']

        # 首先按优先级匹配
        for priority_name in time_field_priority:
            for f in fields:
                fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
                if fname and fname.upper() == priority_name:
                    return fname

        # 如果没找到，查找字段中文名包含"开始时间"、"起始时间"的字段
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            fdesc = f.get('字段含义', f.get('字段中文名', ''))
            if fname and ('开始' in fdesc or '起始' in fdesc or '开始时间' in fdesc):
                return fname

        # 默认为空，等待用户确认
        return '（待用户确认）'

    def _parse_field_type_overrides(self, field_types_input: str) -> Dict[str, str]:
        """解析用户输入的字段类型映射

        Args:
            field_types_input: 用户输入的字段类型映射字符串
                格式1：字段名:类型,字段名:类型（如：TIME:TIMESTAMP,MSISDN:VARCHAR）
                格式2：JSON字符串

        Returns:
            字段名->字段类型的映射字典（字段名统一大写）
        """
        overrides = {}
        if not field_types_input:
            return overrides

        field_types_input = field_types_input.strip()
        if not field_types_input:
            return overrides

        # 尝试JSON格式
        if field_types_input.startswith('{'):
            try:
                import json
                parsed = json.loads(field_types_input)
                for k, v in parsed.items():
                    overrides[k.upper()] = v
                return overrides
            except:
                pass

        # 解析逗号分隔的 字段名:类型 格式
        for item in field_types_input.replace('，', ',').split(','):
            item = item.strip()
            if ':' in item:
                parts = item.split(':')
                if len(parts) >= 2:
                    field_name = parts[0].strip().upper()
                    field_type = parts[1].strip()
                    if field_name and field_type:
                        overrides[field_name] = field_type

        return overrides

    def _get_field_type(self, field_dict: Dict, type_overrides: Dict[str, str]) -> str:
        """获取字段的最终类型

        优先级：用户覆盖类型 > 字段类型_DB > 字段类型 > String

        Args:
            field_dict: 字段信息字典
            type_overrides: 用户输入的类型覆盖映射

        Returns:
            最终的字段类型
        """
        fname = field_dict.get('订阅字段名称', field_dict.get('数据库字段名', ''))
        if not fname:
            return 'String'

        # 优先使用用户覆盖的类型
        if fname.upper() in type_overrides:
            return type_overrides[fname.upper()]

        # 其次使用字段类型_DB，再是字段类型
        ftype = field_dict.get('字段类型_DB', field_dict.get('字段类型', 'String'))
        return ftype if ftype else 'String'


def generate_content(placeholder_type: str, context: Dict, spec_reader=None, knowledge_retriever=None) -> str:
    """便捷函数"""
    generator = AIGenerator(spec_reader, knowledge_retriever)
    return generator.generate(placeholder_type, context)