// ============================================================
// 解析器公共工具
// ============================================================

import type { TocEntry } from "../types.js";

/** 折叠 3 个以上连续换行为 2 个，去掉行尾空格 */
export function collapseBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 给目录条目回填字符偏移。
 * 为什么需要：epub NCX / docx 标题样式自带目录，但只有标题没有位置，
 * 分章引擎要按 offset 切。这里按【顺序】逐个向后查找，避免同名标题错位。
 */
export function locateTocOffsets(text: string, toc: TocEntry[]): TocEntry[] {
  let cursor = 0;
  const out: TocEntry[] = [];
  for (const entry of toc) {
    const needle = normalizeTitle(entry.title);
    if (!needle) continue;
    const idx = findFrom(text, needle, cursor);
    if (idx < 0) {
      out.push({ ...entry });
      continue;
    }
    out.push({ ...entry, offset: idx });
    cursor = idx + needle.length;
  }
  return out;
}

function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 从 from 开始在 text 中查找 needle，容忍内部空白差异 */
function findFrom(text: string, needle: string, from: number): number {
  if (needle.length === 0) return -1;
  // 先试精确匹配（最快路径）
  let idx = text.indexOf(needle, from);
  if (idx >= 0) return idx;

  // 退化为「忽略空白」匹配：按 needle 的片段顺序扫描
  const parts = needle.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return -1;
  let pos = from;
  for (const part of parts) {
    const p = text.indexOf(part, pos);
    if (p < 0) return -1;
    pos = p + part.length;
  }
  return text.indexOf(parts[0]!, Math.max(0, from));
}
