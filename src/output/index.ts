import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DissectResult, MergedEntity, OutputFormat } from "../types.js";

type Item = Record<string, unknown>;

export interface LorebookEntry {
  uid: number;
  key: string[];
  keysecondary: string[];
  content: string;
  comment: string;
  constant: boolean;
  selective: boolean;
  position: number;
  order: number;
  enabled: boolean;
}

export interface Lorebook {
  name: string;
  description: string;
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  entries: Record<string, LorebookEntry>;
}

export interface ExportCard {
  kind: "entity" | "dimension-item";
  title: string;
  markdown: string;
  aliases?: string[];
  dimension?: string;
  fields: Record<string, unknown>;
}

function titleOf(result: DissectResult): string {
  return result.meta.title?.trim() || "未命名书籍";
}

function itemsOf(data: unknown): Item[] {
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items)
    ? items.filter((item): item is Item => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function itemTitle(item: Item, fallback: string): string {
  for (const key of ["name", "title", "concept", "term", "scene", "claim"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function itemMarkdown(item: Item, title: string): string {
  const lines = [`# ${title}`];
  for (const [key, value] of Object.entries(item)) {
    if (key === "name" || key === "title" || value === undefined || value === null || value === "") continue;
    lines.push(`- **${key}**：${text(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function entityMarkdown(entity: MergedEntity): string {
  const aliases = entity.aliases.length ? entity.aliases.join("、") : "无";
  const descriptions = entity.descriptions.length ? entity.descriptions.map((d) => `- ${d}`).join("\n") : "- 暂无描述";
  return `# ${entity.canonical}\n\n- **类型**：${entity.type}\n- **别名**：${aliases}\n- **提及次数**：${entity.mentionCount}\n\n${descriptions}\n`;
}

export function parseFormats(raw: string): OutputFormat[] {
  const allowed = new Set<OutputFormat>(["md", "json", "lorebook", "cards", "prompt"]);
  const formats: OutputFormat[] = [];
  for (const token of raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (!allowed.has(token as OutputFormat)) throw new Error(`未知输出格式：${token}`);
    const format = token as OutputFormat;
    if (!formats.includes(format)) formats.push(format);
  }
  if (formats.length === 0) throw new Error("请至少指定一种输出格式");
  return formats;
}

export function renderMarkdown(result: DissectResult): string {
  const lines = [
    `# ${titleOf(result)}`,
    "",
    `> 模板：${result.meta.template} ｜ 深度：${result.meta.depth} ｜ 模型：${result.meta.model} ｜ Provider：${result.meta.provider}`,
    "",
    "## 拆解概况",
    "",
    `- 输入格式：${result.meta.format}`,
    `- 字符数：${result.meta.charCount.toLocaleString()}；估算 token：${result.meta.tokenEstimate.toLocaleString()}`,
    `- 处理块数：${result.meta.chunkCount}；章节数：${result.chapters.length}`,
    `- 分章策略：${result.chapterDetect.strategy}；置信度：**${result.chapterDetect.confidence}**；得分：${result.chapterDetect.score}`,
  ];
  if (result.chapterDetect.warnings.length) {
    lines.push("", "> ⚠ 警告", ">", ...result.chapterDetect.warnings.map((warning) => `> - ${warning}`));
  }
  lines.push("", `## 实体表（已做别名归并，共 ${result.entities.length} 个）`, "");
  if (result.entities.length) {
    lines.push("| 实体 | 类型 | 别名 | 提及 |", "|---|---|---|---:|");
    for (const entity of result.entities) {
      lines.push(`| ${entity.canonical} | ${entity.type} | ${entity.aliases.join("、") || "—"} | ${entity.mentionCount} |`);
    }
  } else {
    lines.push("暂无实体。 ");
  }
  for (const dimension of result.dimensions) {
    const items = itemsOf(dimension.data);
    lines.push("", `## ${dimension.label}`, "", `> 候选条目 ${dimension.cardCount} 条，归并后 ${items.length} 条`, "");
    if (!items.length) {
      lines.push("暂无条目。 ");
      continue;
    }
    items.forEach((item, index) => {
      const heading = itemTitle(item, `条目 ${index + 1}`);
      lines.push(`### ${heading}`, "");
      for (const [key, value] of Object.entries(item)) {
        if (key === "name" || key === "title" || value === undefined || value === null || value === "") continue;
        lines.push(`- **${key}**：${text(value)}`);
      }
      lines.push("");
    });
  }
  if (result.failures.length) {
    lines.push("## 未完成任务", "", "| 范围 | 原因 | 重试 | 信息 |", "|---|---|---:|---|");
    for (const failure of result.failures) {
      lines.push(`| ${failure.scope} | ${failure.reason} | ${failure.retries} | ${failure.message.replace(/\|/g, "\\|")} |`);
    }
  }
  lines.push("", "---", `由 book-dissector 生成于 ${result.meta.createdAt}`, "");
  return lines.join("\n");
}

export function renderJson(result: DissectResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function buildLorebook(result: DissectResult): Lorebook {
  const entries: Record<string, LorebookEntry> = {};
  let uid = 0;
  const add = (key: string[], keysecondary: string[], content: string, comment: string, position: number) => {
    const id = String(uid);
    entries[id] = {
      uid,
      key,
      keysecondary,
      content,
      comment,
      constant: false,
      selective: true,
      position,
      order: 100 - uid,
      enabled: true,
    };
    uid += 1;
  };
  for (const entity of result.entities) {
    add(
      [entity.canonical, ...entity.aliases],
      [entity.type],
      `【${entity.canonical}】\n别名：${entity.aliases.join("、") || "无"}\n类型：${entity.type}\n${entity.descriptions.join("\n")}`,
      `实体：${entity.canonical}`,
      entity.type === "character" ? 0 : 1,
    );
  }
  for (const dimension of result.dimensions) {
    const content = itemsOf(dimension.data)
      .map((item, index) => itemMarkdown(item, itemTitle(item, `条目 ${index + 1}`)))
      .join("\n");
    add([dimension.label], [dimension.key], content || "暂无条目", `维度：${dimension.label}`, 1);
  }
  return {
    name: `${titleOf(result)} · book-dissector`,
    description: `由 book-dissector 从《${titleOf(result)}》拆解生成`,
    scanDepth: 4,
    tokenBudget: 2048,
    recursiveScanning: false,
    entries,
  };
}

export function buildCards(result: DissectResult): ExportCard[] {
  const cards: ExportCard[] = result.entities.map((entity) => ({
    kind: "entity",
    title: entity.canonical,
    aliases: entity.aliases,
    markdown: entityMarkdown(entity),
    fields: { ...entity },
  }));
  for (const dimension of result.dimensions) {
    itemsOf(dimension.data).forEach((item, index) => {
      const title = itemTitle(item, `${dimension.label} ${index + 1}`);
      cards.push({
        kind: "dimension-item",
        title,
        dimension: dimension.key,
        markdown: itemMarkdown(item, title),
        fields: { ...item },
      });
    });
  }
  return cards;
}

export function renderSystemPrompt(result: DissectResult): string {
  const title = titleOf(result);
  const lines = [
    `你是一名深谙《${title}》设定、人物与叙事规律的写作助手。`,
    "以下知识来自结构化拆解，只能把有依据的条目当作事实。",
    "",
    "# 人物（务必保持人设不崩）",
    "",
  ];
  const characters = result.entities.filter((entity) => entity.type === "character");
  const preferred = characters.length ? characters : result.entities;
  if (preferred.length) {
    for (const entity of preferred) {
      lines.push(`- **${entity.canonical}**（别名：${entity.aliases.join("、") || "无"}）：${entity.descriptions.join("；") || "暂无描述"}`);
    }
  } else {
    lines.push("- 暂无可靠人物条目。 ");
  }
  for (const dimension of result.dimensions) {
    const items = itemsOf(dimension.data);
    if (!items.length) continue;
    lines.push("", `# ${dimension.label}`, "");
    for (const [index, item] of items.entries()) {
      const name = itemTitle(item, `条目 ${index + 1}`);
      const fields = Object.entries(item)
        .filter(([key, value]) => key !== "name" && key !== "title" && value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}=${text(value)}`)
        .join("；");
      lines.push(`- **${name}**：${fields}`);
    }
  }
  lines.push(
    "",
    "# 铁律",
    "",
    "1. 只使用上方已列出的设定；没有依据时明确说不知道，不得补编。",
    "2. 人物言行必须符合人物卡；别名指向同一实体，不得拆成不同人物。",
    "3. 不泄露用户未要求的后续情节；引用拆解结论时保留其不确定性。",
    "",
    "# 输出要求",
    "",
    "- 先给结论，再给依据；涉及改写时说明沿用了哪些设定。",
    "- 若输入与已有设定冲突，先指出冲突并请用户确认。",
    "",
    `<!-- 本提示词由 book-dissector 从《${title}》自动拆解生成。分章策略：${result.chapterDetect.strategy}；置信度：${result.chapterDetect.confidence}；失败任务：${result.failures.length}。 -->`,
    "",
  );
  return lines.join("\n");
}

export function renderFormat(result: DissectResult, format: OutputFormat): string {
  switch (format) {
    case "md":
      return renderMarkdown(result);
    case "json":
      return renderJson(result);
    case "lorebook":
      return `${JSON.stringify(buildLorebook(result), null, 2)}\n`;
    case "cards":
      return `${JSON.stringify(buildCards(result), null, 2)}\n`;
    case "prompt":
      return renderSystemPrompt(result);
  }
}

const FILE_NAMES: Record<OutputFormat, string> = {
  md: "dissect.md",
  json: "dissect.json",
  lorebook: "lorebook.json",
  cards: "cards.json",
  prompt: "system-prompt.txt",
};

export async function writeOutputs(
  result: DissectResult,
  formats: OutputFormat[],
  outDir: string,
): Promise<Array<{ path: string; bytes: number }>> {
  await mkdir(outDir, { recursive: true });
  const written: Array<{ path: string; bytes: number }> = [];
  for (const format of formats) {
    const content = renderFormat(result, format);
    const path = join(outDir, FILE_NAMES[format]);
    await writeFile(path, content, "utf8");
    written.push({ path, bytes: Buffer.byteLength(content, "utf8") });
  }
  const entities = `${JSON.stringify(result.entities, null, 2)}\n`;
  const entityPath = join(outDir, "entities.json");
  await writeFile(entityPath, entities, "utf8");
  written.push({ path: entityPath, bytes: Buffer.byteLength(entities, "utf8") });
  return written;
}
