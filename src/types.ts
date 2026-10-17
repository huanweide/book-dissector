// ============================================================
// 全书公共类型定义
// ------------------------------------------------------------
// 设计原则：所有跨模块流动的数据都是【结构化对象】，不是自由 Markdown 字符串。
// 这是与原型的根本差异 —— 自由字符串无法查询、无法校验、无法跨维度实体对齐。
// ============================================================

/** 支持的输入格式 */
export type InputFormat = "txt" | "md" | "epub" | "docx" | "pdf" | "srt";

/** 目录条目（来自 epub NCX / docx 标题样式 / markdown 标题） */
export interface TocEntry {
  /** 标题文字 */
  title: string;
  /** 层级，1 为最高级（章），2/3 为节 */
  level?: number;
  /** 原文中的字符偏移（若能定位到） */
  offset?: number;
}

/** 解析器统一输出 */
export interface ParsedDocument {
  /** 纯文本正文 */
  text: string;
  /** 元信息 */
  meta: {
    title?: string;
    author?: string;
    language?: string;
    /** 编码检测结果（txt/md） */
    encoding?: string;
    /** 编码检测置信度 0-1 */
    encodingConfidence?: number;
  };
  /** 格式自带的目录（有则优先用于分章） */
  toc?: TocEntry[];
  format: InputFormat;
}

/** 分章策略标识 */
export type ChapterStrategy =
  | "separator" // 用户手动指定分隔（最高优先级）
  | "toc" // 格式自带目录驱动
  | "markdown-heading" // ^#{1,3}
  | "cjk-novel" // 第X章 / 第X节 / 第X回 / 第X卷
  | "english-chapter" // Chapter N / PART ONE / Book Two
  | "numeric-outline" // 1. / 1.1 / 一、
  | "short-line" // 独占短行启发式
  | "fixed-length"; // 兜底：按字数均匀切

/** 分章置信度 */
export type Confidence = "high" | "medium" | "low" | "none";

/** 单章 */
export interface Chapter {
  index: number;
  title: string;
  /** 字符偏移 [start, end) */
  start: number;
  end: number;
  charCount: number;
}

/** 分章结果 */
export interface ChapterResult {
  chapters: Chapter[];
  strategy: ChapterStrategy;
  confidence: Confidence;
  /** 打分明细，供 probe 打印，做到"不假装切好了" */
  score: number;
  /** 人话警告 */
  warnings: string[];
}

/** 按 token 预算切出的处理单元 */
export interface TextChunk {
  id: string;
  /** 所属章节序号列表（用于回填定位） */
  chapterIndexes: number[];
  text: string;
  tokenEstimate: number;
  /** 在原文中的字符范围，便于溯源 */
  start: number;
  end: number;
}

/** 拆解深度 */
export type Depth = "quick" | "standard" | "deep";

/** 单个维度的一条事实卡片（map 阶段产出） */
export interface FactCard {
  /** 所属维度 key */
  dimension: string;
  /** 结构化内容（由模板 zod schema 校验） */
  data: unknown;
  /** 来源 chunk，便于溯源与失败重跑 */
  sourceChunkId: string;
  /** 置信度自评 0-1（可选） */
  confidence?: number;
}

/** 实体提及（map 阶段顺带抽取） */
export interface EntityMention {
  name: string;
  aliases?: string[];
  type?: string;
  /** 一句话描述 */
  description?: string;
  sourceChunkId: string;
}

/** 归并后的实体 */
export interface MergedEntity {
  id: string;
  canonical: string;
  aliases: string[];
  type: string;
  descriptions: string[];
  mentionCount: number;
  sourceChunkIds: string[];
}

/** 维度最终产物 */
export interface DimensionResult {
  key: string;
  label: string;
  data: unknown;
  /** 参与归并的卡片数 */
  cardCount: number;
}

/** 一次拆解的完整结果（可序列化为 json 输出） */
export interface DissectResult {
  meta: {
    file: string;
    format: InputFormat;
    title?: string;
    author?: string;
    template: string;
    depth: Depth;
    model: string;
    provider: string;
    createdAt: string;
    charCount: number;
    tokenEstimate: number;
    chunkCount: number;
  };
  chapters: Chapter[];
  chapterDetect: {
    strategy: ChapterStrategy;
    confidence: Confidence;
    score: number;
    warnings: string[];
  };
  dimensions: DimensionResult[];
  entities: MergedEntity[];
  /** 失败但已透出原因的任务（绝不静默吞错） */
  failures: FailureRecord[];
}

/** 失败记录：必须带 reason 分类，禁止 catch{} 静默 */
export interface FailureRecord {
  scope: string;
  reason: FailureReason;
  message: string;
  retries: number;
}

export type FailureReason =
  | "rate_limit" // 429
  | "server_error" // 5xx
  | "context_overflow" // 超窗
  | "content_filter" // 内容过滤
  | "auth" // 401/403
  | "network" // 连接失败
  | "schema_invalid" // 结构化校验失败
  | "parse_error" // 模型输出不是 JSON
  | "unknown";

/** 支持的导出格式 */
export type OutputFormat = "md" | "json" | "lorebook" | "cards" | "prompt";
