// ============================================================
// @custom：用户自定义模板（JSON）
// ------------------------------------------------------------
// 为什么留这个口：内置 5 套覆盖不了所有书籍（诗歌、法律条文、菜谱…），
// 与其猜用户要什么，不如把维度定义权交出去。
//
// JSON 形态：
// {
//   "id": "my-template", "name": "我的模板", "description": "...", "bestFor": "...",
//   "dimensions": [
//     { "key": "dim1", "label": "维度一", "instruction": "提取…",
//       "entityKind": "character", "fields": [{"name":"age","desc":"年龄"}] }
//   ]
// }
// ============================================================

import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { DimensionDef, TemplateDef } from "./base.js";

const fieldSchema = z.object({
  name: z.string().min(1),
  desc: z.string().default(""),
  required: z.boolean().optional(),
});

const dimensionSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "key 只能用英文字母数字下划线"),
  label: z.string().min(1),
  instruction: z.string().min(1),
  entityKind: z.string().optional(),
  reduceHint: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
});

export const customTemplateSchema = z.object({
  id: z.string().min(1).default("custom"),
  name: z.string().min(1).default("自定义模板"),
  description: z.string().default(""),
  bestFor: z.string().default(""),
  dimensions: z.array(dimensionSchema).min(1, "至少要有一个维度"),
});

/** 解析自定义模板 JSON 字符串 */
export function parseCustomTemplate(json: unknown, fallbackId = "custom"): TemplateDef {
  const parsed = customTemplateSchema.parse({
    ...(json as Record<string, unknown>),
    id: (json as Record<string, unknown>)?.id ?? fallbackId,
  });
  const dimensions: DimensionDef[] = parsed.dimensions.map((d) => ({
    key: d.key,
    label: d.label,
    instruction: d.instruction,
    entityKind: d.entityKind,
    reduceHint: d.reduceHint,
    fields: d.fields?.map((f) => ({ name: f.name, desc: f.desc, required: f.required })),
  }));
  return {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    bestFor: parsed.bestFor,
    dimensions,
  };
}

/** 从文件加载自定义模板 */
export async function loadCustomTemplate(filePath: string): Promise<TemplateDef> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    throw new Error(`读取自定义模板失败：${filePath}（${e instanceof Error ? e.message : String(e)}）`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`自定义模板不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return parseCustomTemplate(json);
  } catch (e) {
    const detail =
      e instanceof z.ZodError
        ? e.issues.map((i) => `  · ${i.path.join(".")}: ${i.message}`).join("\n")
        : String(e);
    throw new Error(`自定义模板校验失败：\n${detail}`);
  }
}
