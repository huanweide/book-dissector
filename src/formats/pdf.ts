// ============================================================
// .pdf 解析（可选依赖，必须优雅降级）
// ------------------------------------------------------------
// 为什么放 optionalDependencies：pdf-parse 依赖原生构建，在国内网络/部分
// 机器上容易装失败。装不上时绝不能让整个 npm install 崩掉，
// 也不能让 CLI 崩 —— 而是给出「请转成 txt」的清晰指引。
// ============================================================

import type { ParsedDocument } from "../types.js";
import { collapseBlankLines } from "./common.js";

/** 明确的可识别错误类型，CLI 层据此打印友好提示 */
export class PdfUnsupportedError extends Error {
  // 为什么不用参数属性 readonly cause：Error 基类（ES2022）已声明 cause，
  // 参数属性会构成重写，TS4115 报错。改走 super(message, { cause }) 标准通道。
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "PdfUnsupportedError";
  }
}

export async function parsePdf(buf: Buffer): Promise<ParsedDocument> {
  // 用变量承载模块名，避免 TS 静态解析一个可能不存在的模块声明
  const specifier = "pdf-parse";
  let mod: any;
  try {
    mod = await import(specifier);
  } catch (e) {
    throw new PdfUnsupportedError(
      "PDF 解析依赖 `pdf-parse` 未安装（本项目将其列为可选依赖，安装失败不影响其余功能）。\n" +
        "  解决方式二选一：\n" +
        "    1) npm i pdf-parse  后重试\n" +
        "    2) 先用任意工具把 PDF 导出为 .txt 或 .md 再拆解（推荐，扫描版 PDF 本就必须走 OCR）",
      e,
    );
  }

  const fn = typeof mod === "function" ? mod : (mod.default ?? mod.parse);
  if (typeof fn !== "function") {
    throw new PdfUnsupportedError("pdf-parse 模块形态异常，无法调用。请改用 .txt/.md 输入。");
  }

  let data: { text?: string; info?: Record<string, unknown> };
  try {
    data = await fn(buf);
  } catch (e) {
    // 加密 PDF / 损坏 PDF 会走到这里：给出可行动的建议而不是堆栈
    throw new PdfUnsupportedError(
      `PDF 解析失败：${e instanceof Error ? e.message : String(e)}\n` +
        "  若为加密或扫描版 PDF，请先解密/OCR 后转成 .txt 再拆解。",
      e,
    );
  }

  const text = collapseBlankLines(data.text ?? "");
  if (!text) {
    throw new PdfUnsupportedError(
      "PDF 未提取到任何文字层 —— 极可能是扫描版（图片）PDF。请先用 OCR 转成 .txt/.md 再拆解。",
    );
  }

  const info = data.info ?? {};
  return {
    text,
    meta: {
      title: typeof info.Title === "string" ? info.Title : undefined,
      author: typeof info.Author === "string" ? info.Author : undefined,
    },
    format: "pdf",
  };
}
