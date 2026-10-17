// ============================================================
// 文本编码自动检测（txt / md）
// ------------------------------------------------------------
// 为什么自己写：原型硬编码 UTF-8，中文网文常见 GBK/GB18030 存档一读就乱码，
// 且乱码后的文本会直接喂给 LLM，导致后面所有维度全错，用户还看不出来。
//
// 检测顺序（从最可靠到最弱）：
//   1. BOM 探测（UTF-8 / UTF-16LE / UTF-16BE）—— 100% 可靠
//   2. UTF-8 严格解码 —— GBK 中文几乎不可能构成合法 UTF-8 序列，故命中即可信
//   3. 多候选解码 + 常用字统计打分（GB18030 / BIG5 / UTF-8 宽松 / Shift_JIS / EUC-KR）
//      判别核心：真实中文文本里「常用字占比」很高（0.6+），
//      用错误编码硬解出来的乱码常用字占比极低（0.1 左右）。
// ============================================================

import iconv from "iconv-lite";

export interface EncodingDetection {
  /** 最终采用的 iconv 编码名 */
  encoding: string;
  /** 置信度 0~1 */
  confidence: number;
  /** 是否命中 BOM */
  bom: boolean;
  /** 解码后的文本 */
  text: string;
}

/** 候选多字节编码（BOM 未命中时参与打分） */
const CANDIDATES = ["utf-8", "gb18030", "big5", "shift_jis", "euc-kr"] as const;

/**
 * 现代汉语高频字表（约 900 字）。
 * 不追求完备，只要求「真实语料命中率远高于乱码」这一统计特性成立。
 */
const COMMON_CJK =
  "的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严句卫调必拿群率型客权责";

const COMMON_SET = new Set(Array.from(COMMON_CJK));

/** 判定一个字符是否为“正常文本字符” */
function isPlausible(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    (code >= 0x20 && code <= 0x7e) || // ASCII 可见
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
    (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
    (code >= 0xff00 && code <= 0xffef) || // 全角
    (code >= 0x00a0 && code <= 0x024f) || // 拉丁扩展
    (code >= 0x0400 && code <= 0x04ff) || // 西里尔
    (code >= 0x3040 && code <= 0x30ff) || // 日文假名
    (code >= 0xac00 && code <= 0xd7af) || // 韩文
    code === 0x2014 ||
    code === 0x2018 ||
    code === 0x2019 ||
    code === 0x201c ||
    code === 0x201d ||
    code === 0x2026 ||
    code === 0x00b7
  );
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

/** 对一次解码结果打分：越高越像“正确的编码” */
function scoreText(text: string): number {
  const sample = text.slice(0, 200_000);
  if (sample.length === 0) return 0;

  let plausible = 0;
  let cjk = 0;
  let commonCjk = 0;
  let replacement = 0;
  let control = 0;

  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd) {
      replacement++;
      continue;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) control++;
    if (isPlausible(code)) plausible++;
    if (isCjk(code)) {
      cjk++;
      if (COMMON_SET.has(ch)) commonCjk++;
    }
  }

  const n = sample.length;
  let score = plausible / n; // 主体：合法字符占比（0~1）
  score -= (replacement / n) * 4; // 替换字符是硬伤
  score -= (control / n) * 2;

  if (cjk > 20) {
    // 常用字占比是区分「真中文」与「乱码中文」的关键
    const commonRatio = commonCjk / cjk;
    score += commonRatio * 0.9;
    if (commonRatio < 0.12) score -= 0.6; // 几乎全是生僻字 → 几乎肯定是解错了
  }
  return score;
}

/** 是否纯 ASCII（纯 ASCII 一律按 utf-8 处理，避免误判） */
export function isAscii(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) if (buf[i]! > 0x7f) return false;
  return true;
}

/**
 * 检测编码并解码。永远不抛异常，最坏返回 utf-8 宽松解码。
 */
export function detectEncoding(buf: Buffer): EncodingDetection {
  // ── 1. BOM 探测 ──────────────────────────────────────────
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { encoding: "utf-8", confidence: 1, bom: true, text: iconv.decode(buf.subarray(3), "utf-8") };
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { encoding: "utf-16le", confidence: 1, bom: true, text: iconv.decode(buf.subarray(2), "utf-16le") };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { encoding: "utf-16be", confidence: 1, bom: true, text: iconv.decode(buf.subarray(2), "utf-16be") };
  }

  if (buf.length === 0) return { encoding: "utf-8", confidence: 1, bom: false, text: "" };

  // ── 2. 纯 ASCII 快路径 ───────────────────────────────────
  if (isAscii(buf)) {
    return { encoding: "utf-8", confidence: 0.99, bom: false, text: buf.toString("utf8") };
  }

  // ── 3. UTF-8 严格解码 ────────────────────────────────────
  try {
    const strict = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    // 极少量替换字符（比如个别损坏字节）仍可接受
    const bad = (strict.match(/\uFFFD/g) ?? []).length;
    if (bad === 0) {
      return { encoding: "utf-8", confidence: 0.97, bom: false, text: strict };
    }
    if (bad / strict.length < 0.001) {
      return { encoding: "utf-8", confidence: 0.8, bom: false, text: strict };
    }
  } catch {
    // 不是合法 UTF-8，继续走多候选打分
  }

  // ── 4. 多候选解码 + 常用字统计打分 ───────────────────────
  let best: { encoding: string; score: number; text: string } | null = null;
  for (const enc of CANDIDATES) {
    let text: string;
    try {
      text = iconv.decode(buf, enc);
    } catch {
      continue;
    }
    const score = scoreText(text);
    if (!best || score > best.score) best = { encoding: enc, score, text };
  }

  if (!best) {
    return { encoding: "utf-8", confidence: 0.3, bom: false, text: buf.toString("utf8") };
  }

  // 归一化置信度：打分是经验值，映射到 0.35~0.95
  const confidence = Math.max(0.35, Math.min(0.95, best.score / 1.9));
  return {
    encoding: best.encoding,
    confidence,
    bom: false,
    text: best.text,
  };
}

/** 统一换行符，去掉零宽字符等噪声 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/\u00a0/g, " ");
}
