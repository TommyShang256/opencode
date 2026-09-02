"""CLI - DIS数据集成工具命令行入口"""
import sys
import os
import argparse
import json
from pathlib import Path

# 设置UTF-8编码（通过环境变量方式更稳定）
if sys.platform == 'win32':
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    # 不要包装stdout，因为这会导致异常时打印失败

# 添加当前目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from indexer import build_index
from searcher import search_dis, DisSearcher
from knowledge_retriever import KnowledgeRetriever
from subscription_parser import parse_subscription_excel
from doc_generator import DocGenerator
from input_collector import InputCollector
from doc_converter import convert_doc


def parse_sample_fields(sample_data: str) -> list:
    """从样例数据中解析字段名

    支持的格式：
    - CSV格式：ENODEBID,CELLID,RAT,IMSI,...
    - TSV格式：ENODEBID\tCELLID\tRAT\tIMSI\t...
    - 管道符分隔：ENODEBID|CELLID|RAT|IMSI|...
    - Markdown表格格式（第一行）
    - 带表头的CSV/TSV：字段名,类型,说明\\n值1,值2,...

    Args:
        sample_data: 样例数据字符串

    Returns:
        字段名列表
    """
    if not sample_data:
        return []

    lines = sample_data.strip().split('\n')
    if not lines:
        return []

    first_line = lines[0].strip()
    if not first_line:
        return []

    # 检测分隔符
    delimiter = ','
    if '|' in first_line:
        delimiter = '|'
    elif '\t' in first_line:
        delimiter = '\t'

    # 解析第一行作为字段名
    fields = [f.strip() for f in first_line.split(delimiter) if f.strip()]

    # 检查是否是Markdown表格格式
    if fields and fields[0].startswith('|'):
        # 去除首尾的 |
        fields = [f.strip().strip('|') for f in first_line.split('|') if f.strip()]

    return fields


def get_skill_dir():
    """获取skill目录路径"""
    # 尝试从环境变量获取（Claude Code 技能调用时会设置）
    skill_dir_env = os.environ.get('CLAUDE_SKILL_DIR')
    if skill_dir_env:
        return Path(skill_dir_env)

    # 尝试从脚本位置往上两级
    script_based = Path(__file__).parent.parent
    if (script_based / "SKILL.md").exists():
        return script_based

    # 尝试从当前工作目录往上找
    cwd = Path.cwd()
    for parent in [cwd] + list(cwd.parents)[:5]:
        if (parent / "SKILL.md").exists():
            return parent

    return script_based


def get_knowledge_dir():
    """获取knowledge目录路径

    优先级：
    1. CLAUDE_SKILL_DIR 环境变量指定的 skill/knowledge 目录
    2. 脚本所在位置往上两级的 knowledge 目录
    3. 当前目录树中包含 SKILL.md 的目录下的 knowledge

    重要：索引文件必须存储在技能目录下的 knowledge/ 中，
    而不是 workspace 的根目录或其他位置。
    """
    skill_dir = get_skill_dir()
    knowledge_dir = skill_dir / "knowledge"

    # 确保 knowledge 目录存在
    if not knowledge_dir.exists():
        knowledge_dir.mkdir(parents=True, exist_ok=True)
        print(f"[INFO] Created knowledge directory: {knowledge_dir}")

    return knowledge_dir


def load_config():
    """加载配置文件"""
    config_path = get_skill_dir() / "config" / "config.yaml"

    if not config_path.exists():
        return {
            "search": {"max_results": 10, "min_confidence": 0.3}
        }

    import yaml
    with open(config_path, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    return config.get('dis_data_inventory', config)


def enrich_fields_from_index(subscription_fields: list, knowledge_dir: str) -> list:
    """从知识库索引补全字段详情

    Args:
        subscription_fields: 订阅字段列表
        knowledge_dir: 知识库目录

    Returns:
        补全后的字段列表
    """
    manifest_path = knowledge_dir / "index_manifest.json"
    if not manifest_path.exists():
        return subscription_fields

    searcher = DisSearcher(str(manifest_path))

    enriched_fields = []
    matched_count = 0
    unmatched_count = 0

    for field in subscription_fields:
        # 获取订阅字段名称
        field_name = field.get('订阅字段名称', '')
        record_name = field.get('话单名称', '')

        if not field_name:
            enriched_fields.append(field)
            continue

        # 尝试从索引中获取详细信息
        all_fields = searcher.get_fields_by_record(record_name)

        enriched = None
        for idx_field in all_fields:
            # 精确匹配
            idx_field_name = idx_field.get('数据库字段名', '')
            if idx_field_name.upper() == field_name.upper():
                enriched = {
                    **field,
                    '字段中文名': idx_field.get('字段中文名', ''),
                    '字段类型': idx_field.get('字段类型', ''),
                    '字段类型_DB': idx_field.get('字段类型_DB', ''),
                    '字段含义': idx_field.get('字段含义', ''),
                    '字段说明': idx_field.get('字段说明', ''),
                    '英文描述': idx_field.get('英文描述', '')
                }
                matched_count += 1
                break

        if enriched:
            enriched_fields.append(enriched)
        else:
            unmatched_count += 1
            enriched_fields.append(field)

    # 打印统计信息
    print(f"  [Index Retrieval] Matched: {matched_count}, Unmatched: {unmatched_count}")

    return enriched_fields


def _ai_recommend_partition(fields: list, user_specified_fields: list = None) -> str:
    """大模型智能推荐分区字段

    根据知识库中的字段信息（大模型分析字段含义后），
    智能推荐适合作为分区字段的时间字段。

    优先使用用户输入中已包含的时间字段。
    """
    if not fields:
        return ''

    # 时间字段优先级（大模型语义分析结果）
    time_priorities = [
        'TIME', 'START_TIME', 'END_TIME', 'RRC_SETUP_START', 'RRC_SETUP_END',
        'CREATE_TIME', 'UPDATE_TIME', 'INSERT_TIME', 'CALL_START_TIME',
        'BEGIN_TIME', 'RECORD_TIME', 'CALL_START', 'CALL_END'
    ]

    # 优先：从用户输入的字段中查找时间字段
    if user_specified_fields:
        for priority in time_priorities:
            for fname in user_specified_fields:
                if fname.upper() == priority:
                    return fname
        # 模糊匹配
        for fname in user_specified_fields:
            fname_upper = fname.upper()
            if any(kw in fname_upper for kw in ['START', 'BEGIN', 'END', 'CREATE', 'UPDATE', 'INSERT']) and ('TIME' in fname_upper or 'DATE' in fname_upper):
                return fname

    # 回退：从所有字段中查找
    # 第一轮：按优先级匹配英文字段名
    for priority in time_priorities:
        for f in fields:
            fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
            if fname.upper() == priority:
                return fname

    # 第二轮：模糊匹配（字段名包含时间关键字）
    time_keywords = ['START', 'BEGIN', 'END', 'CREATE', 'UPDATE', 'INSERT']
    for f in fields:
        fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
        fname_upper = fname.upper()
        if any(kw in fname_upper for kw in time_keywords) and ('TIME' in fname_upper or 'DATE' in fname_upper):
            return fname

    # 第三轮：根据字段中文名/含义判断
    for f in fields:
        fname = f.get('订阅字段名称', f.get('数据库字段名', ''))
        fcn = f.get('字段中文名', '')
        fdesc = f.get('字段含义', '')
        combined = fcn + fdesc
        if any(kw in combined for kw in ['开始', '起始', '创建', '记录']) and ('时间' in combined or '日期' in combined):
            return fname

    return ''


def _ai_recommend_sort_key(fields: list, user_specified_fields: list = None) -> str:
    """大模型智能推荐排序列字段

    根据知识库中的字段信息（大模型分析字段含义后），
    智能推荐适合作为排序列的时间字段。

    优先使用用户输入中已包含的时间字段。
    """
    # 排序列与分区字段通常相同，直接复用
    return _ai_recommend_partition(fields, user_specified_fields)


def cmd_init(args):
    """初始化知识库 - 从数据字典生成索引"""
    skill_dir = get_skill_dir()
    knowledge_dir = get_knowledge_dir()

    print("=" * 60)
    print("DIS Data Integration Tool - Initialize Knowledge Base")
    print("=" * 60)
    print(f"Knowledge dir: {knowledge_dir}")
    print("=" * 60)

    input_dir = args.input_dir.strip() if args.input_dir else None

    if input_dir:
        print(f"\n[Step 1/1] Copy from {input_dir} and generate index...")
    else:
        print(f"\n[Step 1/1] Regenerate index...")

    try:
        result = build_index(str(knowledge_dir), copy_from_dir=input_dir)
        print(f"\n[OK] Index built successfully")
        print(f"  - Records: {result['total_records']}")
        print(f"  - Manifest: {result['manifest_path']}")
        print(f"  - Fields dir: {result['fields_dir']}")

    except Exception as e:
        print(f"\n[X] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n" + "=" * 60)
    print("Done!")
    print("=" * 60)
    print("\nNext steps:")
    print(f"  Search field: /dis-data-research search <keyword>")
    print(f"  List records: /dis-data-research list")


def cmd_list(args):
    """列出所有话单"""
    knowledge_dir = get_knowledge_dir()
    manifest_path = knowledge_dir / "index_manifest.json"

    if not manifest_path.exists():
        print(f"Error: Index manifest not found - {manifest_path}")
        print("Please run: /dis-data-research init <dictionary_dir>")
        sys.exit(1)

    try:
        retriever = KnowledgeRetriever(str(knowledge_dir))
        retriever.load_index(str(manifest_path))
        stats = retriever.get_statistics()

        print(f"=== Knowledge Base Stats ===")
        print(f"Last updated: {stats['last_updated']}")
        print(f"Records: {stats['total_records']}")
        print(f"Fields dir: {retriever.fields_dir}")
        print(f"\nRecord list ({stats['total_records']}):")
        for record in sorted(stats['records']):
            print(f"  - {record}")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


def cmd_search(args):
    """检索字段"""
    config = load_config()
    knowledge_dir = get_knowledge_dir()
    manifest_path = knowledge_dir / "index_manifest.json"

    if not manifest_path.exists():
        print(f"Error: Index manifest not found - {manifest_path}")
        print("Please run: /dis-data-research init <dictionary_dir>")
        sys.exit(1)

    try:
        result = search_dis(
            args.query,
            str(manifest_path),
            max_results=args.max_results,  # None 表示不限制
            min_confidence=config.get('search', {}).get('min_confidence', 0.3),
            output_format=args.format
        )
        print(result)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


def cmd_fields(args):
    """查看指定话单的所有字段"""
    knowledge_dir = get_knowledge_dir()
    manifest_path = knowledge_dir / "index_manifest.json"

    if not manifest_path.exists():
        print(f"Error: Index manifest not found - {manifest_path}")
        print("Please run: /dis-data-research init <dictionary_dir>")
        sys.exit(1)

    try:
        retriever = KnowledgeRetriever(str(knowledge_dir))
        retriever.load_index(str(manifest_path))
        fields = retriever.get_fields_by_record(args.record_name)

        if not fields:
            print(f"Record not found: {args.record_name}")
            sys.exit(1)

        print(f"=== {args.record_name} ===")
        print(f"Fields: {len(fields)}")
        print()
        print("| # | Database Field | Chinese Name | Type | Description |")
        print("|---|----------------|--------------|------|-------------|")
        for i, field in enumerate(fields, 1):
            desc = field.get('字段含义', '')[:40]
            if len(field.get('字段含义', '')) > 40:
                desc += '...'
            print(f"| {i} | {field.get('数据库字段名', '')} | {field.get('字段中文名', '')} | {field.get('字段类型', '')} | {desc} |")

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


def parse_model_overrides(user_input: str) -> dict:
    """从用户输入中解析模型名称覆盖需求

    支持的格式：
    - "存储到clickhouse的模型名为：dis_nr_ue_mr_ck"
    - "存储到kafka的模型名为：test_kafka"
    - "存储到SFTP的模型名为：nr_ue_mr_sftp"
    - "kafka的模型名改为：test_kafka"
    - "clickhouse模型名：dis_nr_ue_mr_ck"
    - "NR_HO_IN_ck" (直接输入模型名)

    Args:
        user_input: 用户输入的完整字符串

    Returns:
        模型覆盖字典，格式：{'clickhouse': 'dis_nr_ue_mr_ck', 'kafka': None, 'sftp': None}
    """
    import re
    overrides = {'sftp': None, 'kafka': None, 'clickhouse': None}

    # ClickHouse 模型名 - 支持多种格式
    patterns_clickhouse = [
        r'clickhouse.*模型名为[：:]\s*([^\s,，]+)',
        r'clickhouse.*模型名[为叫]?\s*[：:]\s*([^\s,，]+)',
        r'storage.*to.*clickhouse.*model[：:]\s*([^\s,，]+)',
        r'存储到[^\s]*clickhouse[^\s]*模型名为[：:]\s*([^\s,，]+)',
        r'clickhouse.*模型名.*为[：:]\s*([^\s,，]+)',
    ]
    for pattern in patterns_clickhouse:
        match = re.search(pattern, user_input, re.IGNORECASE)
        if match:
            overrides['clickhouse'] = match.group(1).strip().rstrip(',，。.;')
            break

    # Kafka 模型名 - 支持多种格式
    patterns_kafka = [
        r'kafka.*模型名为[：:]\s*([^\s,，]+)',
        r'kafka.*模型名[为叫]?\s*[：:]\s*([^\s,，]+)',
        r'存储到[^\s]*kafka[^\s]*模型名为[：:]\s*([^\s,，]+)',
        r'kafka.*模型名.*为[：:]\s*([^\s,，]+)',
    ]
    for pattern in patterns_kafka:
        match = re.search(pattern, user_input, re.IGNORECASE)
        if match:
            overrides['kafka'] = match.group(1).strip().rstrip(',，。.;')
            break

    # SFTP 模型名 - 支持多种格式
    patterns_sftp = [
        r'sftp.*模型名为[：:]\s*([^\s,，]+)',
        r'sftp.*模型名[为叫]?\s*[：:]\s*([^\s,，]+)',
        r'存储到[^\s]*sftp[^\s]*模型名为[：:]\s*([^\s,，]+)',
        r'sftp.*模型名.*为[：:]\s*([^\s,，]+)',
    ]
    for pattern in patterns_sftp:
        match = re.search(pattern, user_input, re.IGNORECASE)
        if match:
            overrides['sftp'] = match.group(1).strip().rstrip(',，。.;')
            break

    # 清理空的覆盖
    return {k: v for k, v in overrides.items() if v is not None}


def cmd_integrate(args):
    """生成集成需求文档

    支持两种场景：
    1. 场景1：从订阅Excel文件生成
    2. 场景2：从用户输入的话单和字段生成

    自动填充规则：
    - 业务目的：自动生成通用描述
    - 分区字段：自动识别时间字段（TIME > START_TIME > END_TIME > RRC_SETUP_START）
    - 排序列：默认为空
    - 数据转换规则：默认为空
    - 样例数据：默认为空

    用户可通过命令行参数覆盖默认值，或通过 refresh 命令修改文档。
    """
    skill_dir = get_skill_dir()
    knowledge_dir = get_knowledge_dir()
    manifest_path = knowledge_dir / "index_manifest.json"

    if not manifest_path.exists():
        print(f"Error: Index manifest not found - {manifest_path}")
        print("Please run: /dis-data-research init <dictionary_dir>")
        sys.exit(1)

    # 加载模板和规范
    template_file = str(skill_dir / "references" / "Template.md")
    spec_file = str(skill_dir / "references" / "Dis_Integration_Specification.md")

    if not Path(template_file).exists():
        print(f"Error: Template file not found - {template_file}")
        sys.exit(1)

    if not Path(spec_file).exists():
        print(f"Error: Spec file not found - {spec_file}")
        sys.exit(1)

    # 解析用户输入
    user_input_str = args.user_input.strip()
    user_inputs = {}

    # 解析模型名称覆盖需求
    model_overrides = parse_model_overrides(user_input_str)
    if model_overrides:
        print(f"\n[Model Override] Detected custom model names:")
        for target, model_name in model_overrides.items():
            print(f"  - {target.upper()}: {model_name}")
        user_inputs['_model_overrides'] = model_overrides

    # 解析命令行参数中的模型覆盖
    cmd_sftp_model = getattr(args, 'sftp_model', None)
    if cmd_sftp_model:
        if '_model_overrides' not in user_inputs:
            user_inputs['_model_overrides'] = {}
        user_inputs['_model_overrides']['sftp'] = cmd_sftp_model
        print(f"\n[Model Override] CLI parameter sets SFTP model: {cmd_sftp_model}")

    cmd_kafka_model = getattr(args, 'kafka_model', None)
    if cmd_kafka_model:
        if '_model_overrides' not in user_inputs:
            user_inputs['_model_overrides'] = {}
        user_inputs['_model_overrides']['kafka'] = cmd_kafka_model
        print(f"\n[Model Override] CLI parameter sets Kafka model: {cmd_kafka_model}")

    cmd_clickhouse_model = getattr(args, 'clickhouse_model', None)
    if cmd_clickhouse_model:
        if '_model_overrides' not in user_inputs:
            user_inputs['_model_overrides'] = {}
        user_inputs['_model_overrides']['clickhouse'] = cmd_clickhouse_model
        print(f"\n[Model Override] CLI parameter sets ClickHouse model: {cmd_clickhouse_model}")

    # 解析用户输入中的参数
    # 格式: 订阅Excel路径 或者 话单名称（配合 --fields 参数或 --sample 参数）
    excel_path = None
    record_name = None
    field_names = []
    user_specified_fields = []  # 保存用户输入的字段列表（用于推荐时优先使用）

    # 获取 --fields 参数
    cmd_fields = getattr(args, 'fields', None)
    if cmd_fields:
        field_names = [f.strip() for f in cmd_fields.split(',') if f.strip()]

    # 获取 --sample 参数，解析样例数据中的字段名
    cmd_sample = getattr(args, 'sample', None)
    if cmd_sample:
        sample_fields = parse_sample_fields(cmd_sample)
        if sample_fields:
            if field_names:
                # 合并字段列表，去重（--fields 优先）
                field_names = list(dict.fromkeys(field_names + sample_fields))
            else:
                field_names = sample_fields
            print(f"  [Sample] Parsed {len(sample_fields)} fields from sample data")

    if user_input_str.endswith('.xlsx') or user_input_str.endswith('.xls'):
        # 场景1：订阅Excel
        excel_path = user_input_str
        print(f"\n[Scene 1] Processing subscription Excel: {excel_path}")
    else:
        # 场景2：话单和字段
        if ':' in user_input_str:
            # 兼容旧格式：话单名称:字段1,字段2,...
            parts = user_input_str.split(':', 1)
            record_name = parts[0].strip()
            if not field_names:  # 如果没有通过 --fields 或 --sample 指定字段
                field_names = [f.strip() for f in parts[1].split(',') if f.strip()]
        else:
            # 话单名称（字段通过 --fields 或 --sample 参数指定）
            record_name = user_input_str

        # 保存用户输入的字段列表（用于推荐时优先使用）
        user_specified_fields = field_names

        print(f"\n[Scene 2] Processing manual input:")
        print(f"  Record: {record_name}")
        print(f"  Fields: {field_names}")

    # ===== 场景1：从Excel生成 =====
    if excel_path:
        print(f"\n[Step 1/3] Parse subscription Excel...")

        if not Path(excel_path).exists():
            print(f"Error: Excel file not found - {excel_path}")
            sys.exit(1)

        try:
            parse_result = parse_subscription_excel(excel_path)
            subscriptions = parse_result['subscriptions']
            print(f"  Found {len(subscriptions)} subscriptions")

            # 选择第一个订阅（或让用户指定）
            if not subscriptions:
                print("Error: No subscriptions found in Excel")
                sys.exit(1)

            subscription = subscriptions[0]
            subscription_name = subscription.get('订阅名称', '')
            record_name = subscription.get('话单名称', '')

            print(f"  Selected subscription: {subscription_name}")
            print(f"  Record name: {record_name}")

        except Exception as e:
            print(f"Error: Parse failed - {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

        # 获取该订阅的字段
        print(f"\n[Step 2/3] Enrich fields from index...")
        subscription_fields = parse_result['fields'].get(subscription_name, [])
        print(f"  Found {len(subscription_fields)} fields in subscription")

        # 保存用户输入的字段列表（用于推荐时优先使用）
        user_specified_fields = [f.get('订阅字段名称', f.get('数据库字段名', '')) for f in subscription_fields]

        # 补全字段详情
        enriched_fields = enrich_fields_from_index(subscription_fields, knowledge_dir)

    # ===== 场景2：从输入生成 =====
    else:
        print(f"\n[Step 1/2] Retrieve fields from index...")

        retriever = KnowledgeRetriever(str(knowledge_dir))
        retriever.load_index(str(manifest_path))

        # 获取话单的所有字段
        all_record_fields = retriever.get_fields_by_record(record_name)

        if not all_record_fields:
            # 话单不存在，使用占位符配置
            print(f"  [Warning] Record '{record_name}' not found in knowledge base")
            print(f"  Using default configuration with user-provided fields")
            all_record_fields = []
        else:
            print(f"  Found {len(all_record_fields)} fields in record {record_name}")

        # 筛选指定的字段
        enriched_fields = []
        matched_count = 0
        unmatched_count = 0

        for input_field in field_names:
            input_field_upper = input_field.upper()
            matched = False

            # 尝试从数据字典中匹配
            for field in all_record_fields:
                db_field_name = field.get('数据库字段名', '').upper()
                if db_field_name == input_field_upper or db_field_name.replace('_', '') == input_field_upper.replace('_', ''):
                    # 匹配成功，使用数据字典信息
                    enriched_fields.append({
                        '订阅字段名称': field.get('数据库字段名', ''),
                        '字段中文名': field.get('字段中文名', ''),
                        '字段类型': field.get('字段类型', ''),
                        '字段类型_DB': field.get('字段类型_DB', ''),
                        '字段含义': field.get('字段含义', ''),
                        '字段说明': field.get('字段说明', '')
                    })
                    matched = True
                    matched_count += 1
                    break

            if not matched:
                # 匹配失败，添加占位符字段
                enriched_fields.append({
                    '订阅字段名称': input_field,
                    '字段中文名': '(未在数据字典中找到)',
                    '字段类型': 'String',
                    '字段类型_DB': 'String',
                    '字段含义': '(未在数据字典中找到)',
                    '字段说明': '(未在数据字典中找到，请补充字段信息)'
                })
                unmatched_count += 1

        print(f"  Matched: {matched_count}, Unmatched: {unmatched_count}")

        # 将推荐的分区字段和排序列字段也添加到 enriched_fields 中
        # 确保这些AI推荐的字段能被正确添加到模型字段列表
        recommended_partition = _ai_recommend_partition(all_record_fields, user_specified_fields)
        if recommended_partition:
            partition_upper = recommended_partition.upper()
            # 检查分区字段是否已在 enriched_fields 中
            if not any(f.get('订阅字段名称', f.get('数据库字段名', '')).upper() == partition_upper for f in enriched_fields):
                # 查找该字段在 all_record_fields 中的完整信息
                for field in all_record_fields:
                    fname = field.get('订阅字段名称', field.get('数据库字段名', ''))
                    if fname.upper() == partition_upper:
                        enriched_fields.append({
                            '订阅字段名称': field.get('数据库字段名', ''),
                            '字段中文名': field.get('字段中文名', ''),
                            '字段类型': field.get('字段类型', ''),
                            '字段类型_DB': field.get('字段类型_DB', ''),
                            '字段含义': field.get('字段含义', ''),
                            '字段说明': field.get('字段说明', '')
                        })
                        print(f"  [Auto-add] Added AI recommended partition field: {recommended_partition}")
                        break

        if not enriched_fields:
            print("Warning: No fields matched. Using first 10 fields from record.")
            enriched_fields = [
                {
                    '订阅字段名称': f.get('数据库字段名', ''),
                    '字段中文名': f.get('字段中文名', ''),
                    '字段类型': f.get('字段类型', ''),
                    '字段类型_DB': f.get('字段类型_DB', ''),
                    '字段含义': f.get('字段含义', ''),
                    '字段说明': f.get('字段说明', '')
                }
                for f in all_record_fields[:10]
            ]

        subscription = {
            '订阅名称': record_name,
            '话单名称': record_name,
            '分隔符': '|'
        }
        subscription_name = record_name

    # ===== 配置信息处理 =====
    print("\n" + "=" * 60)
    print("Processing Configuration")
    print("=" * 60)

    # 检查是否有通过命令行参数传递的用户输入
    cmd_purpose = getattr(args, 'purpose', None)
    cmd_sample = getattr(args, 'sample', None)
    cmd_partition = getattr(args, 'partition', None)
    cmd_sort_key = getattr(args, 'sort_key', None)
    cmd_transformation = getattr(args, 'transformation', None)
    cmd_field_types = getattr(args, 'field_types', None)

    # 检查是否有通过环境变量传递的用户输入（作为备选）
    env_purpose = os.environ.get('DIS_PURPOSE', '').strip()
    env_sample = os.environ.get('DIS_SAMPLE_DATA', '').strip()
    env_partition = os.environ.get('DIS_PARTITION_FIELD', '').strip()
    env_sort_key = os.environ.get('DIS_SORT_KEY', '').strip()
    env_transform = os.environ.get('DIS_TRANSFORMATION_RULES', '').strip()
    env_field_types = os.environ.get('DIS_FIELD_TYPES', '').strip()

    # 业务目的
    purpose_value = cmd_purpose or env_purpose
    if purpose_value:
        user_inputs['目的'] = purpose_value
        print(f"  [Purpose] Custom purpose provided")

    # 样例数据
    sample_value = cmd_sample or env_sample
    if sample_value:
        user_inputs['样例数据'] = sample_value
        print(f"  [Sample] Sample data provided")

    # 数据转换规则
    transform_value = cmd_transformation or env_transform
    if transform_value:
        user_inputs['数据转换规则'] = transform_value
        print(f"  [Transformation] Custom rules: {transform_value}")

    # 分区字段 - 大模型根据知识库字段信息智能推荐
    partition_value = cmd_partition or env_partition
    if partition_value:
        user_inputs['分区字段'] = partition_value
        print(f"  [Partition] Custom field: {partition_value}")
    else:
        # 大模型分析话单的所有字段（all_record_fields）来智能推荐分区字段
        # 注意：优先从用户指定的字段中推荐，但也会从话单的所有字段中查找
        recommended_partition = _ai_recommend_partition(all_record_fields, user_specified_fields)
        if recommended_partition:
            user_inputs['分区字段'] = recommended_partition
            print(f"  [Partition] AI recommended: {recommended_partition}")
        else:
            # 如果没有推荐到，设置默认值提示用户
            user_inputs['分区字段'] = 'TIME'
            print(f"  [Partition] No time field found, using default: TIME (please update via refresh)")

    # 排序列配置 - 大模型根据知识库字段信息智能推荐
    sort_key_value = cmd_sort_key or env_sort_key
    if sort_key_value:
        # 格式化为表格
        sort_key_config = "| 输出字段 | 排序列顺序 |\n| -------- | ---------- |\n"
        for line in sort_key_value.split(';'):
            parts = line.split(',')
            if len(parts) >= 2:
                sort_key_config += f"| {parts[0].strip()} | {parts[1].strip()} |\n"
            elif len(parts) == 1 and parts[0].strip():
                sort_key_config += f"| {parts[0].strip()} | 1 |\n"
        user_inputs['排序列配置'] = sort_key_config
        print(f"  [Sort Key] Custom sort key provided")
    else:
        # 大模型分析话单的所有字段（all_record_fields）来智能推荐排序列
        recommended_sort_key = _ai_recommend_sort_key(all_record_fields, user_specified_fields)
        if recommended_sort_key:
            sort_key_config = f"| 输出字段 | 排序列顺序 |\n| -------- | ---------- |\n| {recommended_sort_key} | 1 |\n"
            user_inputs['排序列配置'] = sort_key_config
            print(f"  [Sort Key] AI recommended: {recommended_sort_key},1")
        else:
            # 如果没有推荐到，设置默认值提示用户
            sort_key_config = f"| 输出字段 | 排序列顺序 |\n| -------- | ---------- |\n| TIME | 1 |\n"
            user_inputs['排序列配置'] = sort_key_config
            print(f"  [Sort Key] No time field found, using default: TIME,1 (please update via refresh)")

    # 字段类型配置
    field_types_value = cmd_field_types or env_field_types
    if field_types_value:
        user_inputs['字段类型映射'] = field_types_value
        print(f"  [Field Types] Custom types: {field_types_value}")

    print("\n  (Other fields will use recommended defaults)")
    print("  (Use refresh command to modify after generation)")

    # ===== 生成文档 =====
    print("\n" + "=" * 60)
    print("Generating Integration Document...")
    print("=" * 60)

    try:
        generator = DocGenerator(template_file, spec_file)
        doc_content = generator.generate(subscription_name, subscription, enriched_fields, user_inputs)

        # 检查是否跳过 Word 文档生成
        skip_docx = getattr(args, 'skip_docx', False)
        if skip_docx:
            os.environ['DIS_SKIP_DOCX'] = '1'
            print(f"  [INFO] Word document generation skipped (--skip-docx)")

        # 保存到桌面（Markdown和Word都会自动生成，除非设置了 skip-docx）
        output_path = generator.save_to_desktop(doc_content, subscription_name)
        print(f"  [OK] Markdown document generated: {output_path}")

    except Exception as e:
        print(f"Error: Generate failed - {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    print("\n" + "=" * 60)
    print(f"Done! Documents saved to Desktop.")
    print("=" * 60)
    print(f"  Markdown: {output_path}")
    if not skip_docx:
        print(f"  Word: {Path(output_path).with_suffix('.docx')}")
    print("\n[INFO] 如需补充信息，可使用 refresh 命令：")
    print(f"[INFO]   /dis-data-research refresh \"{output_path}\" -u '{{\"目的\":\"值\"}}'")


def cmd_refresh(args):
    """刷新需求文档命令"""
    import json

    doc_path = args.document

    if not Path(doc_path).exists():
        print(f"Error: Document not found - {doc_path}")
        sys.exit(1)

    # 解析用户输入
    try:
        user_inputs = json.loads(args.user_inputs) if args.user_inputs else {}
    except json.JSONDecodeError as e:
        print(f"Error: JSON parse failed - {e}")
        sys.exit(1)

    print("=" * 60)
    print("Refresh Integration Document")
    print("=" * 60)
    print(f"Document: {doc_path}")
    print(f"Inputs: {user_inputs}")
    print("=" * 60)

    # 刷新文档
    collector = InputCollector(doc_path)
    pending_before = collector.scan_pending()

    success = collector.refresh_document(user_inputs)

    if success:
        # 重新加载检查
        collector.reload()
        pending_after = collector.scan_pending()

        print("\n[OK] Document refreshed")
        print("=" * 60)
        print(f"Before refresh: {len(pending_before)} pending items")
        print(f"After refresh: {len(pending_after)} pending items")

        # 检测是否有对应的Word文档需要刷新
        md_path = Path(doc_path)
        if md_path.suffix.lower() == '.md':
            docx_path = md_path.with_suffix('.docx')
            if docx_path.exists():
                print(f"\nDetected synchronized Word document, refreshing...")
                try:
                    # 重新转换Word
                    docx_path_new = convert_doc(str(md_path))
                    print(f"[OK] Word document refreshed: {docx_path_new}")
                except MemoryError:
                    print(f"[WARN] Word refresh skipped due to insufficient memory")
                    print(f"[INFO] Markdown document will be used instead")
                except Exception as e:
                    print(f"[WARN] Word refresh failed: {e}")

        if pending_after:
            print("\nRemaining pending items:")
            prompt = collector.format_prompt(pending_after)
            print(prompt)
        else:
            print("\n[OK] All information completed!")
    else:
        print("\n[X] Error: Failed to refresh document")


def main():
    """主入口"""
    parser = argparse.ArgumentParser(
        description='DIS Data Integration Tool - Generate integration documents',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Initialize knowledge base
  /dis-data-research init "D:\\data\\dis\\"
  /dis-data-research init

  # List all records
  /dis-data-research list

  # Search fields
  /dis-data-research search "SID"
  /dis-data-research search "DIS_STREAMING"

  # View record fields
  /dis-data-research fields "DIS_STREAMING"

  # Generate integration document
  # Scene 1: From subscription Excel
  /dis-data-research integrate "D:\\data\\subscript.xlsx"
  # Scene 2: From manual input
  /dis-data-research integrate "DIS_STREAMING:SID,MSISDN,IMSI,START_TIME,END_TIME"
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # init命令
    parser_init = subparsers.add_parser('init', help='Initialize knowledge base')
    parser_init.add_argument('input_dir', nargs='?', help='Dictionary dir (optional)')
    parser_init.set_defaults(func=cmd_init)

    # list命令
    parser_list = subparsers.add_parser('list', help='List all records')
    parser_list.set_defaults(func=cmd_list)

    # search命令
    parser_search = subparsers.add_parser('search', help='Search fields')
    parser_search.add_argument('query', help='Query keyword')
    parser_search.add_argument('-n', '--max-results', type=int, default=None, help='Max results (default: no limit)')
    parser_search.add_argument('-f', '--format', choices=['markdown', 'json'], default='markdown', help='Output format')
    parser_search.set_defaults(func=cmd_search)

    # fields命令
    parser_fields = subparsers.add_parser('fields', help='View record fields')
    parser_fields.add_argument('record_name', help='Record name')
    parser_fields.set_defaults(func=cmd_fields)

    # integrate命令
    parser_integrate = subparsers.add_parser('integrate', help='Generate integration document')
    parser_integrate.add_argument('user_input', nargs='?', help='话单名称（如：NR_HO_IN）或订阅Excel路径')
    parser_integrate.add_argument('--fields', '-f', help='字段列表（多个用逗号分隔，如：DATATYPE,CALLID,TIME）')
    parser_integrate.add_argument('--purpose', '-p', help='业务目的')
    parser_integrate.add_argument('--sample', '-s', help='样例数据')
    parser_integrate.add_argument('--partition', help='分区字段')
    parser_integrate.add_argument('--sort-key', help='排序列配置（格式：字段名,顺序，用逗号分隔多行）')
    parser_integrate.add_argument('--transformation', '-t', help='数据转换规则（新增字段，多个用逗号分隔）')
    parser_integrate.add_argument('--clickhouse-model', help='ClickHouse模型名称（覆盖话单名称）')
    parser_integrate.add_argument('--kafka-model', help='Kafka模型名称（覆盖话单名称）')
    parser_integrate.add_argument('--sftp-model', help='SFTP模型名称（覆盖话单名称）')
    parser_integrate.add_argument('--field-types', help='字段类型映射（格式：字段名:类型，多个用逗号分隔，如：TIME:TIMESTAMP,MSISDN:VARCHAR）')
    parser_integrate.add_argument('--skip-docx', action='store_true', help='跳过Word文档生成（内存不足时使用）')
    parser_integrate.set_defaults(func=cmd_integrate)

    # refresh命令
    parser_refresh = subparsers.add_parser('refresh', help='Refresh integration document')
    parser_refresh.add_argument('document', help='Document path')
    parser_refresh.add_argument('-u', '--user-inputs', required=True, help='User inputs in JSON format')
    parser_refresh.set_defaults(func=cmd_refresh)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()