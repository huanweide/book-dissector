// ============================================================
// 章节 → token 预算 chunk
// ------------------------------------------------------------
// 策略：
//   · 短章合并：多个小章凑满预算再发一次，省调用次数（省钱）
//   · 长章拆分：单章超预算就按段落/句子再切，绝不超窗
//   · 保留 chapterIndexes，保证每个 chunk 都能溯源回章节
// ============================================================

import type { Chapter, TextChunk } from "../types.js";
import { estimateTokens, splitTextByTokens } from "./token.js";

export function buildChunks(text: string, chapters: Chapter[], budget: number): TextChunk[] {
  const chunks: TextChunk[] = [];
  let bufChapters: Chapter[] = [];
  let bufText = "";

  const flush = () => {
    if (bufChapters.length === 0) return;
    const start = bufChapters[0]!.start;
    const end = bufChapters[bufChapters.length - 1]!.end;
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      chapterIndexes: bufChapters.map((c) => c.index),
      text: bufText,
      tokenEstimate: estimateTokens(bufText),
      start,
      end,
    });
    bufChapters = [];
    bufText = "";
  };

  for (const ch of chapters) {
    const chText = text.slice(ch.start, ch.end);
    const chTokens = estimateTokens(chText);

    // 单章就超预算 → 先吐掉已累积的，再把这一章内部切开
    if (chTokens > budget) {
      flush();
      for (const piece of splitTextByTokens(chText, budget, ch.start)) {
        chunks.push({
          id: `chunk-${chunks.length + 1}`,
          chapterIndexes: [ch.index],
          text: piece.text,
          tokenEstimate: piece.tokenEstimate,
          start: piece.start,
          end: piece.end,
        });
      }
      continue;
    }

    if (bufChapters.length > 0 && estimateTokens(bufText) + chTokens > budget) flush();
    bufChapters.push(ch);
    bufText += (bufText ? "\n\n" : "") + chText;
  }
  flush();

  return chunks;
}

/**
 * quick 档采样：从全部 chunk 中等距取 n 个（含首、中、尾）。
 * 为什么：quick 的定位是「先花最少的钱看个大概」，全量跑违背它的意义。
 */
export function sampleChunks(chunks: TextChunk[], n: number): TextChunk[] {
  if (chunks.length <= n) return chunks;
  const out: TextChunk[] = [];
  const step = (chunks.length - 1) / (n - 1 || 1);
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i * step);
    const c = chunks[Math.min(chunks.length - 1, idx)];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}
