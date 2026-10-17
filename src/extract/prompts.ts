// ============================================================
// map / reduce 两阶段的 prompt
// ------------------------------------------------------------
// 设计要点：
//   1. map 阶段【一次调用覆盖全部维度】（原型 deep 模式是 15 个维度各发一遍
//      6 万字，钱烧在这上面；这里全文只过一遍）
//   2. reduce 阶段只喂「候选条目」，不喂原文 —— 归并成本与原书长度解耦
//   3. 反复强调「没依据不许写」—— 用户最大抱怨就是 AI 先编一句错误总结
//      再围绕它自我论证，必须在 prompt 层面堵住
// ============================================================

import type { TextChunk } from "../types.js";
import type { DimensionDef, TemplateDef } from "../templates/base.js";
import { describeDimensionSchema } from "../templates/base.js";

export const MAP_SYSTEM = `你是书籍结构化拆解引擎。你的唯一任务：从给定的原文片段中，按指定维度抽取「事实卡片」。

铁律：
1. 只输出 JSON 对象，不要任何解释文字，不要用 Markdown 代码块包裹。
2. 只提取原文中【明确出现】的信息。没有原文依据的推测、总结、评价一律不写。
   用户最大的抱怨是「AI 拆出来头头是道，用起来全是废话」，根源就是模型先编一句
   大概率错误的总结、再围绕它自我论证。宁可少写，不要编造。
3. 每条 evidence 必须是原文里真实存在的片段（≤60字），编不出来的就留空字符串。
4. aliases 要填全该实体在原文里的所有称呼（本名、称号、绰号、敬称）。
5. 提取不到就返回空数组，绝不凑数。
6. 不要重复输出同一条信息。`;

export function buildMapPrompt(
  template: TemplateDef,
  dims: DimensionDef[],
  chunk: TextChunk,
  chunkIndex: number,
  chunkTotal: number,
  bookTitle: string,
): string {
  const dimLines = dims.map((d) => `- ${d.key}（${d.label}）：${d.instruction}`).join("\n");
  const schemaLines = dims.map((d) => describeDimensionSchema(d)).join("\n");

  return `【书籍】${bookTitle || "(未知名)"}
【模板】${template.name}
【片段】第 ${chunkIndex + 1} / ${chunkTotal} 段（覆盖章节序号：${chunk.chapterIndexes.join(",") || "-"}）

【维度定义】
${dimLines}

【原文】
${chunk.text}

【输出 JSON 结构（严格遵守）】
{
  "dimensions": {
${dims.map((d) => `    "${d.key}": { "items": [] }`).join(",\n")}
  },
  "entities": [
    { "name": "实体名", "aliases": ["别称"], "type": "character|concept|location|item|method|case|work|other", "description": "一句话说明" }
  ]
}

【每个维度的字段说明】
${schemaLines}

现在输出 JSON：`;
}

export const REDUCE_SYSTEM = `你是书籍拆解的归并器。输入是从全书各片段抽取的候选条目，存在重复、别名不一致、粒度不一、偶有编造的问题。

你的任务：
1. 去重：同一实体的不同称呼合并为一条，别名并入 aliases。
2. 补全：能合并的条目把信息并到一起，不要丢失细节。
3. 清洗：删除没有原文依据、明显是模型臆测的条目。
4. 排序：按重要程度从高到低排列（最重要的在前）。
5. 只输出 JSON，结构必须与输入一致，不要解释。`;

export function buildReducePrompt(
  dim: DimensionDef,
  candidates: Record<string, unknown>[],
  bookTitle: string,
): string {
  // 控制体积：只送字段值，超长截断
  const trimmed = candidates.slice(0, 120).map((c) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c)) {
      if (typeof v === "string") out[k] = v.length > 240 ? `${v.slice(0, 240)}…` : v;
      else out[k] = v;
    }
    return out;
  });

  return `【书籍】${bookTitle || "(未知名)"}
【维度】${dim.label}（${dim.key}）
${dim.reduceHint ? `【归并要求】${dim.reduceHint}` : ""}
【原始维度指令】${dim.instruction}

【候选条目（共 ${candidates.length} 条，最多展示 120 条）】
${JSON.stringify(trimmed, null, 1)}

【输出 JSON 结构】
{
  "${dim.key}": { "items": [ ...最终条目... ] }
}

现在输出 JSON：`;
}
