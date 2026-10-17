// ============================================================
// .srt 字幕解析
// ------------------------------------------------------------
// 字幕是「剧本拆解法」的高价值素材：去掉序号和时间轴就是纯对白流。
// 时间轴保留为章节边界依据（每 N 分钟一节可选，此处只做纯文本化）。
// ============================================================

import { readFile } from "node:fs/promises";
import type { ParsedDocument } from "../types.js";
import { detectEncoding, normalizeText } from "./encoding.js";
import { collapseBlankLines } from "./common.js";

export async function parseSrt(filePath: string): Promise<ParsedDocument> {
  const buf = await readFile(filePath);
  const det = detectEncoding(buf);
  const raw = normalizeText(det.text);

  const lines = raw.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "") continue;
    if (/^\d+$/.test(t)) continue; // 序号
    if (/^\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(t)) continue; // 时间轴
    kept.push(t);
  }

  return {
    text: collapseBlankLines(kept.join("\n")),
    meta: { encoding: det.encoding, encodingConfidence: det.confidence },
    format: "srt",
  };
}
