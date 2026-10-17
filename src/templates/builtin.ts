// ============================================================
// 内置模板：webnovel / tradebook / textbook / paper / screenplay
// ------------------------------------------------------------
// 「什么书都能拆」的实现方式 = 换模板而不是换工具。
// 每个模板 = 一组维度定义（key + 中文指令 + 字段），
// 指令措辞沿用原型 prompts.ts 的中文风格，但强制结构化输出。
// ============================================================

import type { TemplateDef } from "./base.js";

// ─── 1. 网文 / 小说 ──────────────────────────────────────────
const webnovel: TemplateDef = {
  id: "webnovel",
  name: "网文 / 小说",
  description: "爽点公式、钩子、付费卡点、金手指、角色卡、伏笔 —— 面向网文创作与仿写",
  bestFor: "网络小说、出版小说、轻小说、短篇集",
  dimensions: [
    {
      key: "basic_info",
      label: "基本信息",
      instruction:
        "提取作品基本信息：书名、作者、类型流派、体量、一句话核心卖点、目标读者群。每个要点作为一条 item。",
    },
    {
      key: "world_setting",
      label: "世界观设定",
      instruction:
        "提取世界观：世界背景、核心规则、历史脉络、种族/文明体系、力量介质（灵气/魔法/科技）、世界的危险与机遇。每个要点一条 item。",
    },
    {
      key: "characters",
      label: "角色卡",
      entityKind: "character",
      instruction:
        "提取所有角色：主角、主要配角、反派。每条 item 写清身份、外貌、性格、能力、动机、与主角关系、说话风格、关键剧情节点。aliases 字段务必填全原文里出现过的所有称呼。",
      fields: [
        { name: "role", desc: "主角/配角/反派/龙套" },
        { name: "speech_style", desc: "说话风格特点" },
      ],
      reduceHint: "同名/别名角色必须合并成一张卡，别名全部并进 aliases，不要出现重复角色。",
    },
    {
      key: "power_system",
      label: "力量体系",
      instruction:
        "提取力量/战斗体系：等级划分、每级能力描述、提升方式、战斗方式、规则与限制。等级按从低到高排列。",
      fields: [{ name: "tier", desc: "等级序号或名称" }],
    },
    {
      key: "plot_thread",
      label: "情节脉络",
      instruction:
        "按时间顺序列出主要情节节点，每条一句话，标出转折点与所在章节范围，并说明叙事节奏快慢。",
      fields: [
        { name: "chapter_range", desc: "所在章节范围，如 第3-7章" },
        { name: "turning_point", desc: "是否为转折点：true/false" },
      ],
    },
    {
      key: "hooks",
      label: "爽点与钩子",
      instruction:
        "提取爽点与钩子：打脸/升级/收获/揭秘/反转等爽点类型，每章结尾的悬念钩子。每条写清：发生了什么、为什么爽、可复用的公式（如「受辱—隐忍—暴露实力—众人震惊」）。这是本模板最有价值的部分，务必抽象成可复用公式。",
      fields: [
        { name: "hook_type", desc: "爽点类型：打脸/升级/收获/揭秘/反转/危机/情感" },
        { name: "formula", desc: "可复用的爽点公式，写成「A→B→C」的链式结构" },
        { name: "chapter_range", desc: "所在章节范围" },
      ],
      reduceHint: "把同类爽点归并成少数几条通用公式，而不是逐章罗列。",
    },
    {
      key: "paywall_points",
      label: "付费卡点",
      instruction:
        "找出付费卡点：章节在何处断在最紧张/最悬念的时刻，断章前发生了什么、悬念是什么、读者为什么想点下一章。",
      fields: [
        { name: "chapter_range", desc: "卡点所在章节" },
        { name: "suspense", desc: "断章处留下的悬念" },
      ],
    },
    {
      key: "golden_finger",
      label: "金手指",
      instruction:
        "提取主角的金手指/外挂：是什么、怎么获得、能力边界、代价或限制、在剧情中如何被使用。",
      fields: [
        { name: "cost", desc: "使用代价或限制" },
        { name: "origin", desc: "获得方式" },
      ],
    },
    {
      key: "rhythm",
      label: "节奏曲线",
      instruction:
        "分析叙事节奏：铺垫/冲突/高潮/过渡的分布，平均多少字一个小高潮，情绪起伏的周期，以及节奏上的问题。",
      fields: [
        { name: "phase", desc: "铺垫/冲突/高潮/过渡" },
        { name: "chapter_range", desc: "对应章节范围" },
      ],
    },
    {
      key: "foreshadowing",
      label: "伏笔",
      instruction:
        "列出所有伏笔：埋设位置、内容、是否已回收、回收位置、重要性。特别标出悬而未决的伏笔。",
      fields: [
        { name: "planted_at", desc: "埋设位置（章节）" },
        { name: "resolved_at", desc: "回收位置（章节），未回收填空字符串" },
        { name: "importance", desc: "高/中/低" },
      ],
    },
    {
      key: "style_analysis",
      label: "写作风格分析",
      instruction:
        "分析写作风格：平均句长、对话占比、描写密度(1-10)、叙事视角、语言风格、节奏特点、擅长的场景类型，并摘抄 2-3 段代表性原文（放进 evidence）。",
    },
  ],
};

// ─── 2. 商业 / 社科读物 ──────────────────────────────────────
const tradebook: TemplateDef = {
  id: "tradebook",
  name: "商业 / 社科读物",
  description: "核心论点、论证结构、案例、可执行清单 —— 面向「读完就能用」",
  bestFor: "商业管理、自我提升、社科普及、传记",
  dimensions: [
    {
      key: "core_thesis",
      label: "核心论点",
      instruction:
        "提炼全书核心论点：作者到底在主张什么、想改变读者的哪个认知、一句话版本是什么。",
    },
    {
      key: "argument_structure",
      label: "论证结构",
      instruction:
        "拆解论证结构：分论点有哪些、彼此是并列/递进/对照关系、支撑每个分论点的理由是什么。",
      fields: [{ name: "relation", desc: "与其他论点的关系：并列/递进/对照/反驳" }],
    },
    {
      key: "case_studies",
      label: "案例",
      entityKind: "case",
      instruction:
        "提取书中案例：案例主体、背景、做了什么、结果如何、这个案例在证明什么论点。",
      fields: [
        { name: "subject", desc: "案例主体（公司/人物/组织）" },
        { name: "outcome", desc: "结果" },
        { name: "proves", desc: "用于证明哪个论点" },
      ],
    },
    {
      key: "key_concepts",
      label: "关键概念",
      entityKind: "concept",
      instruction:
        "提取书中提出或重新定义的关键概念/术语：概念名、作者的定义、通俗解释、与常识的差异。",
      fields: [{ name: "definition", desc: "作者给出的定义" }],
    },
    {
      key: "action_checklist",
      label: "可执行清单",
      instruction:
        "把书里的主张转成可执行的动作清单：每条写清「做什么」「什么时候做」「怎么判断做成了」。只保留书中明确建议过的，不要自己发挥。",
      fields: [
        { name: "action", desc: "具体动作" },
        { name: "when", desc: "适用场景/时机" },
        { name: "done_signal", desc: "完成信号" },
      ],
      reduceHint: "去重后按可执行性排序，合并重复的建议。",
    },
    {
      key: "target_audience",
      label: "目标读者与前提",
      instruction: "说明目标读者是谁、读者需要具备什么前提、什么人不适合读这本书。",
    },
    {
      key: "style_analysis",
      label: "表达风格分析",
      instruction:
        "分析表达风格：叙事方式、论证密度、举例比例、语言难度、章节组织方式（每章是否自洽）。",
    },
  ],
};

// ─── 3. 教材 / 技术书 ────────────────────────────────────────
const textbook: TemplateDef = {
  id: "textbook",
  name: "教材 / 技术书",
  description: "知识树、概念依赖图、习题要点 —— 面向学习与备课",
  bestFor: "教材、技术手册、考试用书、在线课程讲义",
  dimensions: [
    {
      key: "knowledge_tree",
      label: "知识树",
      entityKind: "concept",
      instruction:
        "列出本书的知识结构：每个知识点名、属于哪个上级模块、在书中的位置。形成一棵树，parent 字段填上级知识点名（顶层留空）。",
      fields: [
        { name: "parent", desc: "上级知识点名，顶层留空字符串" },
        { name: "module", desc: "所属模块/章节" },
      ],
      reduceHint: "同一知识点只保留一条，补全 parent 形成树。",
    },
    {
      key: "concept_dependencies",
      label: "概念依赖图",
      entityKind: "concept",
      instruction:
        "标出概念之间的依赖关系：掌握 A 之前必须先理解哪些概念（prerequisites），A 又是哪些概念的前置（enables）。",
      fields: [
        { name: "prerequisites", desc: "前置概念名，数组" },
        { name: "enables", desc: "由此解锁的概念名，数组" },
      ],
    },
    {
      key: "definitions",
      label: "概念定义",
      entityKind: "concept",
      instruction:
        "提取书中给出的严格定义：概念名、原文定义、适用条件、易混淆点。定义必须照抄书中的表述，不要改写。",
      fields: [
        { name: "conditions", desc: "适用条件/前提" },
        { name: "confusable_with", desc: "易混淆概念" },
      ],
    },
    {
      key: "exercise_points",
      label: "习题要点",
      instruction:
        "提取习题/例题：题目考的是什么知识点、解题关键步骤、常见错解。",
      fields: [
        { name: "tests", desc: "考查的知识点" },
        { name: "key_steps", desc: "解题关键步骤" },
        { name: "common_mistake", desc: "常见错误" },
      ],
    },
    {
      key: "chapter_outline",
      label: "章节纲要",
      instruction: "按章节列出纲要：每章讲什么、核心结论、与前后章的关系。",
      fields: [{ name: "chapter_range", desc: "章节范围" }],
    },
    {
      key: "prerequisites",
      label: "前置知识",
      instruction: "列出读这本书前需要掌握的知识，以及书中假定读者已经会了什么。",
    },
  ],
};

// ─── 4. 论文 ────────────────────────────────────────────────
const paper: TemplateDef = {
  id: "paper",
  name: "论文 / 学术文章",
  description: "问题、方法、实验、结论、创新点、可改进处 —— 面向文献阅读与复现",
  bestFor: "期刊/会议论文、学位论文、技术报告、预印本",
  dimensions: [
    {
      key: "research_problem",
      label: "研究问题",
      instruction: "明确论文要解决的问题：问题是什么、为什么重要、此前为什么没解决好。",
    },
    {
      key: "method",
      label: "方法",
      entityKind: "method",
      instruction:
        "拆解方法：核心思路、具体步骤、关键公式/算法、与已有方法的本质差异。写清输入和输出。",
      fields: [
        { name: "steps", desc: "关键步骤，数组" },
        { name: "differs_from", desc: "与已有方法的差异" },
      ],
    },
    {
      key: "experiments",
      label: "实验设计",
      instruction:
        "提取实验设置：数据集、评价指标、基线方法、消融实验、超参设置。每个要素一条。",
      fields: [
        { name: "dataset", desc: "数据集名称" },
        { name: "metric", desc: "评价指标" },
      ],
    },
    {
      key: "results",
      label: "结果与数据",
      instruction:
        "提取关键结果：主实验结果、相对基线的提升幅度、消融结论。只写论文里明确给出的数字，没有就留空。",
      fields: [{ name: "number", desc: "关键数字/指标值" }],
    },
    {
      key: "contributions",
      label: "创新点",
      instruction: "归纳论文的贡献：作者声称的几点贡献分别是什么，哪一条最硬。",
      fields: [{ name: "strength", desc: "贡献强度：核心/次要" }],
    },
    {
      key: "limitations",
      label: "局限与可改进处",
      instruction:
        "列出作者承认的局限，以及你从方法/实验设计中能看出的可改进之处（必须与原文依据对应）。",
      fields: [{ name: "source", desc: "作者自述 / 分析得出" }],
    },
    {
      key: "related_work",
      label: "相关工作",
      entityKind: "work",
      instruction: "提取相关工作：被引用/对比的工作名称、本文如何定位自己与它们的关系。",
      fields: [{ name: "relation", desc: "对比/继承/改进/对立" }],
    },
  ],
};

// ─── 5. 剧本 / 字幕 ──────────────────────────────────────────
const screenplay: TemplateDef = {
  id: "screenplay",
  name: "剧本 / 影视",
  description: "场次、节拍、人物弧光、对白风格 —— 面向影视与短剧创作",
  bestFor: "剧本、字幕(.srt)、分镜、小说改编",
  dimensions: [
    {
      key: "scenes",
      label: "场次",
      instruction:
        "切出场次：每场的时间地点、出场人物、发生了什么、这场的功能（推进/铺垫/转折/收束）。",
      fields: [
        { name: "location", desc: "地点" },
        { name: "time", desc: "时间（日/夜/具体时刻）" },
        { name: "characters", desc: "出场人物名，数组" },
        { name: "function", desc: "推进/铺垫/转折/收束" },
      ],
      reduceHint: "相邻且地点人物相同的场次合并为一场。",
    },
    {
      key: "beats",
      label: "节拍",
      instruction:
        "拆解节拍：每个beat的冲突是什么、谁主动、结果如何、情绪走向。按时间顺序排列。",
      fields: [
        { name: "conflict", desc: "该节拍的核心冲突" },
        { name: "who_drives", desc: "主动方" },
        { name: "outcome", desc: "结果" },
        { name: "emotion", desc: "情绪走向，如 紧张→释放" },
      ],
    },
    {
      key: "character_arcs",
      label: "人物弧光",
      entityKind: "character",
      instruction:
        "梳理人物弧光：角色起点状态、欲望、阻碍、转折点、终点状态。aliases 填全所有称呼。",
      fields: [
        { name: "want", desc: "角色想要什么" },
        { name: "obstacle", desc: "阻碍是什么" },
        { name: "turning_point", desc: "转变发生在哪里" },
        { name: "end_state", desc: "终点状态" },
      ],
    },
    {
      key: "dialogue_style",
      label: "对白风格",
      instruction:
        "分析对白风格：句子长度、潜台词密度、口头禅、人物之间语言差异、代表性对白片段（放进 evidence）。",
    },
    {
      key: "act_structure",
      label: "幕结构",
      instruction: "标出幕结构与关键情节点：第一幕转折点、中点、第二幕转折点、高潮、结局。",
      fields: [
        { name: "act", desc: "第几幕" },
        { name: "position", desc: "在全文中的位置（占比或章节）" },
      ],
    },
    {
      key: "themes",
      label: "主题",
      instruction: "归纳主题：作品在讨论什么、通过哪组人物关系呈现、主题是如何被论证的。",
    },
  ],
};

export const BUILTIN_TEMPLATES: TemplateDef[] = [webnovel, tradebook, textbook, paper, screenplay];
