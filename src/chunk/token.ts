// ============================================================
// Token 估算与预算切分
// ------------------------------------------------------------
// 为什么按 token 而不是字符：原型按字符硬塞 6~8 万，中文 1 字≈1 token、
// 英文 1 字≈0.25 token，同样字符数在不同语言下 token 相差 3~4 倍，
// 长书必然超窗。这里统一在 token 维度做预算。
//
// 为什么不引 tiktoken：原生依赖体积大且各 provider 词表不同；
// 本估算刻意【略微高估】（中文 1 字按 1.05 token），宁可多切一刀也不要超窗。
// ============================================================

const CJK_RE =
  /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]/g;

/**
 * 估算 token 数。
 * 规则：CJK 字符 ×1.05；拉丁/数字词 ×1.3；其余标点符号 ×0.4。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const _ of text.matchAll(CJK_RE)) cjk++;

  const latin = text.replace(CJK_RE, " ");
  const words = latin.match(/[A-Za-z0-9'’\-_/.]+/g)?.length ?? 0;
  const symbols = Math.max(0, latin.replace(/[A-Za-z0-9'’\-_/.\s]/g, "").length);

  return Math.ceil(cjk * 1.05 + words * 1.3 + symbols * 0.4);
}

/** 在不超过 budget 的前提下，把文本切成若干块（优先段落边界，其次句子，最后硬切） */
export function splitTextByTokens(
  text: string,
  budget: number,
  offsetBase = 0,
): { text: string; start: number; end: number; tokenEstimate: number }[] {
  const out: { text: string; start: number; end: number; tokenEstimate: number }[] = [];
  if (!text.trim()) return out;

  if (estimateTokens(text) <= budget) {
    return [
      {
        text,
        start: offsetBase,
        end: offsetBase + text.length,
        tokenEstimate: estimateTokens(text),
      },
    ];
  }

  // 1) 先按段落边界贪心累积
  const segments = splitKeepingDelims(text, /\n{1,}/);
  let buf = "";
  let bufStart = offsetBase;

  const flush = () => {
    if (!buf.trim()) return;
    out.push({
      text: buf,
      start: bufStart,
      end: bufStart + buf.length,
      tokenEstimate: estimateTokens(buf),
    });
    bufStart += buf.length;
    buf = "";
  };

  for (const seg of segments) {
    // 单段就超限 → 先把已累积的吐出，再按句子拆这段
    if (estimateTokens(seg) > budget) {
      flush();
      const sentences = splitKeepingDelims(seg, /(?<=[。！？!?.；;\n])/);
      for (const s of sentences) {
        if (estimateTokens(buf) + estimateTokens(s) > budget) flush();
        buf += s;
        if (estimateTokens(buf) >= budget * 0.95) flush();
      }
      continue;
    }
    if (estimateTokens(buf) + estimateTokens(seg) > budget) flush();
    buf += seg;
    if (estimateTokens(buf) >= budget * 0.95) flush();
  }
  flush();

  // 2) 兜底：仍有超 budget 的块（长段无标点，如代码/表格）→ 硬切
  const finalOut: typeof out = [];
  for (const chunk of out) {
    if (chunk.tokenEstimate <= budget) {
      finalOut.push(chunk);
      continue;
    }
    const hardSize = Math.max(200, Math.floor(chunk.text.length * (budget / chunk.tokenEstimate) * 0.95));
    let pos = 0;
    while (pos < chunk.text.length) {
      const slice = chunk.text.slice(pos, pos + hardSize);
      finalOut.push({
        text: slice,
        start: chunk.start + pos,
        end: chunk.start + pos + slice.length,
        tokenEstimate: estimateTokens(slice),
      });
      pos += hardSize;
    }
  }
  return finalOut;
}

/** 按正则切分但保留分隔符（保证拼接后无损） */
function splitKeepingDelims(text: string, re: RegExp): string[] {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
    const start = m.index ?? 0;
    parts.push(text.slice(last, start) + m[0]);
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.filter((p) => p.length > 0);
}
