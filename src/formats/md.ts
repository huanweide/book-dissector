// ============================================================
// .md 解析
// ------------------------------------------------------------
// Markdown 的 # 标题就是天然目录，必须优先交给分章引擎当 toc 用。
// ============================================================

import { readFile } from "node:fs/promises";
import type { ParsedDocument, TocEntry } from "../types.js";
import { detectEncoding, normalizeText } from "./encoding.js";
import { collapseBlankLines, locateTocOffsets } from "./common.js";

export async function parseMarkdown(filePath: string): Promise<ParsedDocument> {
  const buf = await readFile(filePath);
  const det = detectEncoding(buf);
  const text = collapseBlankLines(normalizeText(det.text));

  // 扫描 # 标题 → toc（带字符偏移）
  const headings: TocEntry[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (m) headings.push({ title: m[2]!.trim(), level: m[1]!.length, offset });
    offset += line.length + 1;
  }

  return {
    text,
    meta: {
      encoding: det.encoding,
      encodingConfidence: det.confidence,
      // 首个一级标题当作书名
      title: headings.find((h) => h.level === 1)?.title,
    },
    toc: locateTocOffsets(text, headings),
    format: "md",
  };
}
