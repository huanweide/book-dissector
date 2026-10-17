// ============================================================
// 维度 / 模板的公共定义与 schema 构造
// ------------------------------------------------------------
// 为什么每维度都要 schema：原型输出是自由 Markdown 字符串，
// 结果既不能查询、也不能校验，更没法做跨维度实体对齐
// （「萧炎」和「炎帝」永远是两个人）。这里所有维度都是 zod 结构化对象。
//
// 为什么字段刻意保持「扁平 + 少量」：JSON mode 在中小模型上，
// 嵌套层级一深就开始瞎编。扁平的 items[] 是跨 provider 最稳的形态。
// ============================================================

import { z } from "zod";

export interface FieldDef {
  name: string;
  desc: string;
  required?: boolean;
}

export interface DimensionDef {
  key: string;
  label: string;
  /** 注入给 LLM 的提取指令（中文措辞继承原型，但要求结构化输出） */
  instruction: string;
  /** 除公共字段外的维度专属字段 */
  fields?: FieldDef[];
  /** 该维度是否产出「实体」（角色/概念/地点…），用于实体归并 */
  entityKind?: string;
  /** reduce 阶段的归并提示 */
  reduceHint?: string;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** 适配的书类型，用于 README 与 probe 提示 */
  bestFor: string;
  dimensions: DimensionDef[];
}

/** 公共字段：every card 都有 */
const COMMON_FIELDS: FieldDef[] = [
  { name: "name", desc: "条目名称（角色名/概念名/事件名，短，不要写句子）", required: true },
  { name: "detail", desc: "该条目的具体说明，1-3 句，必须基于原文", required: true },
  { name: "evidence", desc: "原文依据：引用一句最能支撑的原文片段（≤60字），没有就留空字符串" },
  { name: "tags", desc: "标签数组，便于检索，如 ['主角','反派'] / ['核心论点']" },
  { name: "aliases", desc: "同一条目在原文中的其他称呼/别名数组，如 萧炎 的 ['炎帝','萧家三少']" },
  { name: "confidence", desc: "你对这条提取的确信度，0-1 的小数" },
];

/** 构造某维度的 zod schema */
export function buildDimensionSchema(dim: DimensionDef): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const f of [...COMMON_FIELDS, ...(dim.fields ?? [])]) {
    const base = f.name === "tags" || f.name === "aliases" ? z.array(z.string()) : z.unknown();
    const typed = f.name === "confidence" ? z.number().min(0).max(1) : base;
    // 为什么对 required 字段加 refine：z.unknown() 连 undefined 都会放过，
    // 原实现里「必填」名存实亡——模型漏掉 name/detail 时校验不报错，
    // 缺字段的卡片会一路流到输出层。这里显式拒绝 undefined。
    shape[f.name] = f.required
      ? typed.refine((v) => v !== undefined, { message: `必填字段缺失` })
      : typed.optional();
  }
  return z.object({ items: z.array(z.object(shape)) });
}

/** 把维度 schema 描述成给 LLM 看的字段说明 */
export function describeDimensionSchema(dim: DimensionDef): string {
  const lines = [...COMMON_FIELDS, ...(dim.fields ?? [])].map(
    (f) =>
      `  - ${f.name}${f.required ? "（必填）" : "（可选）"}: ${f.desc}${
        f.name === "tags" || f.name === "aliases" ? "（字符串数组）" : ""
      }${f.name === "confidence" ? "（0-1 数字）" : ""}`,
  );
  return [
    `"${dim.key}": { "items": [`,
    ...lines.map((l) => `    ${l}`),
    `  ] }`,
  ].join("\n");
}

/** 宽松解析：模型偶尔把 items 写成别的形态，先容错再校验 */
export function parseDimensionOutput(
  dim: DimensionDef,
  raw: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }

  const normalized = normalizeShape(json, dim.key);
  const schema = buildDimensionSchema(dim);
  const result = schema.safeParse(normalized);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300),
  };
}

/** 从可能带 ```json 围栏 / 前后废话的输出里抠出 JSON */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : raw;
  const start = body.search(/[[{]/);
  if (start < 0) return body.trim();
  const candidate = body.slice(start);
  // 为什么必须截到平衡闭合处：模型经常在 JSON 后面追加解释文字，
  // 原实现两个分支都返回整个 candidate，导致 JSON.parse 失败、
  // map 阶段白白多花一次修复调用、reduce 阶段误报 schema_invalid。
  const stack: string[] = [];
  let inStr = false;
  let escape = false;
  let end = -1;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return end > 0 ? candidate.slice(0, end) : candidate;
}

/**
 * 把模型输出的各种形状归一化成 { items: [...] }。
 * 常见跑偏：直接给数组、只给 {"items": {...}}、key 用了中文名等。
 */
export function normalizeShape(json: unknown, dimKey: string): unknown {
  if (Array.isArray(json)) return { items: json };
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj;
    if (Array.isArray(obj[dimKey])) return { items: obj[dimKey] };
    const inner = obj[dimKey];
    if (inner && typeof inner === "object" && Array.isArray((inner as Record<string, unknown>).items)) {
      return inner;
    }
    // 只给了一个对象 → 包成单元素数组
    if (typeof obj.name === "string" || typeof obj.detail === "string") return { items: [obj] };
    // 取第一个数组型的 value
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return { items: v };
    }
  }
  return { items: [] };
}

/** 取出某维度结果里的条目数组（供输出层渲染） */
export function itemsOf(data: unknown): Record<string, unknown>[] {
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items)) {
    return (data as Record<string, unknown>).items as Record<string, unknown>[];
  }
  return [];
}
