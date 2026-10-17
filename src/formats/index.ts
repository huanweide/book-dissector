// ============================================================
// 格式解析统一入口
// ------------------------------------------------------------
// 统一输出 { text, meta, toc }，屏蔽格式差异；
// 任何解析失败都抛出带「可行动建议」的错误，绝不让 CLI 崩在堆栈里。
// ============================================================

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { InputFormat, ParsedDocument } from "../types.js";
import { parseTxt } from "./txt.js";
import { parseMarkdown } from "./md.js";
import { parseEpub } from "./epub.js";
import { parseDocx } from "./docx.js";
import { parsePdf, PdfUnsupportedError } from "./pdf.js";
import { parseSrt } from "./srt.js";

export { parseEpub } from "./epub.js";
export { parseDocx } from "./docx.js";
export { parsePdf, PdfUnsupportedError } from "./pdf.js";
export { parseTxt } from "./txt.js";
export { parseMarkdown } from "./md.js";
export { parseSrt } from "./srt.js";
export { detectEncoding, normalizeText, isAscii } from "./encoding.js";
export { headingLevel } from "./docx.js";
export { parseNcx } from "./epub.js";

const EXT_MAP: Record<string, InputFormat> = {
  ".txt": "txt",
  ".text": "txt",
  ".md": "md",
  ".markdown": "md",
  ".epub": "epub",
  ".docx": "docx",
  ".pdf": "pdf",
  ".srt": "srt",
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_MAP);

export function detectFormat(filePath: string): InputFormat {
  const ext = extname(filePath).toLowerCase();
  const fmt = EXT_MAP[ext];
  if (!fmt) {
    throw new Error(
      `不支持的文件格式：${ext || "(无扩展名)"}\n` +
        `  当前支持：${SUPPORTED_EXTENSIONS.join(" / ")}\n` +
        `  若是其他格式，请先导出为 .txt 或 .md（推荐，分章最准）`,
    );
  }
  return fmt;
}

/** 读取并解析任意支持格式 */
export async function parseFile(filePath: string): Promise<ParsedDocument> {
  const format = detectFormat(filePath);
  try {
    switch (format) {
      case "txt":
        return await parseTxt(filePath);
      case "md":
        return await parseMarkdown(filePath);
      case "srt":
        return await parseSrt(filePath);
      case "epub":
        return await parseEpub(await readFile(filePath));
      case "docx":
        return await parseDocx(await readFile(filePath));
      case "pdf":
        return await parsePdf(await readFile(filePath));
    }
  } catch (e) {
    if (e instanceof PdfUnsupportedError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    // 统一包裹一层，带上文件名，方便用户定位
    throw new Error(`解析 ${filePath} 失败：${msg}`);
  }
}

/** probe 命令用：只探格式，不调 LLM */
export async function probeFile(filePath: string) {
  const format = detectFormat(filePath);
  const doc = await parseFile(filePath);
  return { format, doc };
}
