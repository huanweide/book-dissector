// ============================================================
// 模板注册表
// ============================================================

import { BUILTIN_TEMPLATES } from "./builtin.js";
import { loadCustomTemplate } from "./custom.js";
import type { TemplateDef } from "./base.js";

export { BUILTIN_TEMPLATES } from "./builtin.js";
export { loadCustomTemplate, parseCustomTemplate, customTemplateSchema } from "./custom.js";
export type { TemplateDef, DimensionDef, FieldDef } from "./base.js";
export {
  buildDimensionSchema,
  describeDimensionSchema,
  parseDimensionOutput,
  extractJson,
  normalizeShape,
  itemsOf,
} from "./base.js";

export const CUSTOM_PREFIX = "@custom";

export function listTemplates(): TemplateDef[] {
  return BUILTIN_TEMPLATES;
}

export class UnknownTemplateError extends Error {
  constructor(id: string) {
    super(
      `未知模板：${id}\n  内置模板：${BUILTIN_TEMPLATES.map((t) => t.id).join(" / ")}\n` +
        `  自定义模板：@custom:<你的模板.json>`,
    );
    this.name = "UnknownTemplateError";
  }
}

/**
 * 解析模板标识：
 *   webnovel            → 内置
 *   @custom:./x.json    → 自定义（同步返回 null，交给 resolveTemplateAsync）
 */
export function getTemplate(id: string): TemplateDef | null {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id.toLowerCase());
  return builtin ?? null;
}

export async function resolveTemplate(spec: string): Promise<TemplateDef> {
  const trimmed = spec.trim();
  if (trimmed.toLowerCase().startsWith(CUSTOM_PREFIX)) {
    const rest = trimmed.slice(CUSTOM_PREFIX.length);
    const path = rest.startsWith(":") || rest.startsWith("=") ? rest.slice(1).trim() : "";
    if (!path) {
      throw new Error("使用自定义模板时必须给出 JSON 路径，例如：--template \"@custom:./my-template.json\"");
    }
    return await loadCustomTemplate(path);
  }
  const t = getTemplate(trimmed);
  if (!t) throw new UnknownTemplateError(trimmed);
  return t;
}
