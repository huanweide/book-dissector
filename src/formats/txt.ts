// ============================================================
// .txt 解析
// ------------------------------------------------------------
// 核心：编码自动检测（原型硬编码 UTF-8 会乱码，这里修掉）。
// ============================================================

import { readFile } from "node:fs/promises";
import type { ParsedDocument } from "../types.js";
import { detectEncoding, normalizeText } from "./encoding.js";
import { collapseBlankLines } from "./common.js";

export async function parseTxt(filePath: string): Promise<ParsedDocument> {
  const buf = await readFile(filePath);
  const det = detectEncoding(buf);
  return {
    text: collapseBlankLines(normalizeText(det.text)),
    meta: {
      encoding: det.encoding,
      encodingConfidence: det.confidence,
    },
    format: "txt",
  };
}
