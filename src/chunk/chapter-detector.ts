// ============================================================
// 通用分章引擎（本项目核心差异点）
// ------------------------------------------------------------
// 原型的问题：正则只认「第X章 / Chapter N」，命中 <3 就按 4000 字硬切，
// 且 UI 静默显示「已识别 N 章」——用户根本不知道分章是假的。
// 英文书 / 教材 / 论文 / 剧本 / 无章节号的现代小说全部退化。
//
// 本引擎的做法：多策略并行召回 → 置信度打分选优 → 低置信度必须显式告警。
// 铁律：宁可返回 confidence:'none' 并告诉用户「我没切对」，
//      也绝不返回一堆假章节还假装成功。
// ============================================================

import type { Chapter, ChapterResult, ChapterStrategy, Confidence, TocEntry } from "../types.js";

export interface DetectOptions {
  /** 格式自带目录（epub NCX / docx 标题样式 / md 标题），优先级最高 */
  toc?: TocEntry[];
  /** 用户手动指定的分隔符（字符串；isSeparatorRegex=true 时按正则处理） */
  separator?: string;
  separatorIsRegex?: boolean;
  /** 少于该数量视为「没切出来」，默认 3 */
  minChapters?: number;
  /** 兜底均匀切分时每章目标字数，默认 4000 */
  targetChars?: number;
  /** 标题最大长度，超过就不像标题，默认 60 */
  maxTitleChars?: number;
}

interface Heading {
  title: string;
  offset: number;
  line: number;
}

interface Line {
  text: string;
  start: number;
  index: number;
}

// ─── 各策略正则 ─────────────────────────────────────────────

/** 中文网文：第X章 / 第X节 / 第X回 / 第X卷 / 序章 / 楔子 / 番外 / 尾声 */
const CJK_NOVEL_RE =
  /^[\s【\[]*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章节節回卷巻篇折出幕集部](?:\s*[（(][^）)]*[）)])?|第\s*[一二三四五六七八九十]+\s*卷|序章|楔子|引子|序|前言|尾声|尾聲|后记|後記|番外|终章|終章|结局|結局|附录|附錄)[\s：:、.．·\-—】\]]*(.{0,60})$/;

/** 英文：Chapter N / PART ONE / Book Two / Act III / Scene 4 / Prologue */
// 为什么把「Chapter N」整体作为第 1 组：matchTitle 用 m[1] 当前缀，
// 原正则会拆成 keyword/number 两组，导致标题丢掉编号（"Chapter 5" → "Chapter"）。
const EN_CHAPTER_RE =
  /^[\s*_]*((chapter|part|book|section|act|scene|volume|prologue|epilogue|appendix)\s+(\d+|[IVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final))\b[\s*_]*[:\-–—.]*[\s*_]*(.{0,80})$/i;

/** Markdown 标题 */
const MD_HEADING_RE = /^(#{1,3})\s+(.+?)\s*#*$/;

/** 数字大纲：1. / 1.1 / 一、/ 1) */
// 为什么把编号捕获成第 1 组：原写法是非捕获组，matchTitle 读 m[1] 得到
// undefined，命中 "1. 引言" 这类行时会直接抛 TypeError。
const NUMERIC_OUTLINE_RE = /^[\s]*((?:\d+(?:[.．]\d+)*|[一二三四五六七八九十]{1,4})\s*[、.．)）])\s*(.{1,60})$/;

/** 句末标点 */
const SENTENCE_END_RE = /[。！？!?….;；]$/;

// ─── 主入口 ─────────────────────────────────────────────────

export function detectChapters(text: string, opts: DetectOptions = {}): ChapterResult {
  const minChapters = opts.minChapters ?? 3;
  const targetChars = opts.targetChars ?? 4000;
  const maxTitleChars = opts.maxTitleChars ?? 60;

  // 0) 用户手动分隔符优先级最高：他说了算，不再猜
  if (opts.separator) {
    const headings = separatorHeadings(text, opts.separator, opts.separatorIsRegex ?? false);
    if (headings.length >= 1) {
      const chapters = buildChapters(text, headings, "前言");
      return {
        chapters,
        strategy: "separator",
        confidence: headings.length >= minChapters ? "high" : "medium",
        score: 8,
        warnings:
          headings.length < minChapters
            ? [`手动分隔符只切出 ${headings.length} 段，请确认分隔符是否正确。`]
            : [],
      };
    }
  }

  const lines = toLines(text);

  // 1) 各策略并行召回
  const candidates: { strategy: ChapterStrategy; headings: Heading[]; bonus: number }[] = [];

  // 为什么改名 tocHs：局部变量曾与函数 tocHeadings 同名，形成遮蔽，
  // 导致 TS7022/TS2448（自引用初始值 + 先用后声明）。
  const tocHs = opts.toc?.length ? tocHeadings(text, lines, opts.toc) : [];
  if (tocHs.length > 0) candidates.push({ strategy: "toc", headings: tocHs, bonus: 2 });

  candidates.push({
    strategy: "markdown-heading",
    headings: regexHeadings(lines, (line) => {
      const m = line.match(MD_HEADING_RE);
      return m ? m[2]!.trim() : null;
    }),
    bonus: 1,
  });

  candidates.push({
    strategy: "cjk-novel",
    headings: regexHeadings(lines, (line) => matchTitle(line, CJK_NOVEL_RE, maxTitleChars)),
    bonus: 1,
  });

  candidates.push({
    strategy: "english-chapter",
    headings: regexHeadings(lines, (line) => matchTitle(line, EN_CHAPTER_RE, maxTitleChars)),
    bonus: 1,
  });

  candidates.push({
    strategy: "numeric-outline",
    headings: regexHeadings(lines, (line) => matchTitle(line, NUMERIC_OUTLINE_RE, maxTitleChars)),
    bonus: 0,
  });

  candidates.push({ strategy: "short-line", headings: shortLineHeadings(lines), bonus: -1 });

  // 2) 打分选优
  let best: { strategy: ChapterStrategy; headings: Heading[]; score: number } | null = null;
  for (const c of candidates) {
    if (c.headings.length === 0) continue;
    const score = scoreHeadings(c.headings, text.length, minChapters) + c.bonus;
    if (!best || score > best.score) best = { strategy: c.strategy, headings: c.headings, score };
  }

  // 3) 全部策略都没召回够 → 兜底均匀切，且 confidence = 'none'
  if (!best || best.headings.length < minChapters) {
    const chapters = fixedLengthChapters(text, targetChars);
    const warnings = [
      `未能识别任何章节结构（最佳策略命中 ${best?.headings.length ?? 0} 处，少于阈值 ${minChapters}）。`,
      `已按每 ${targetChars} 字均匀切出 ${chapters.length} 段 —— 这不是真实章节，仅供 map-reduce 切块。`,
      `建议：用 --separator 手动指定分隔符或正则，例如：`,
      `    --separator '第'            （中文网文）`,
      `    --separator '^\\\\d+\\\\.\\\\s'      （数字大纲，配合 --separator-regex）`,
      `    --separator '^\\[场景'        （剧本，配合 --separator-regex）`,
    ];
    return { chapters, strategy: "fixed-length", confidence: "none", score: 0, warnings };
  }

  const confidence = scoreToConfidence(best.score);
  const chapters = buildChapters(text, best.headings, "前言");
  const warnings: string[] = [];

  if (confidence === "low") {
    warnings.push(
      `分章置信度【低】（策略：${describeStrategy(best.strategy)}，得分 ${best.score.toFixed(1)}）。`,
      `已切出 ${chapters.length} 章，但很可能是错的，请人工抽查几章边界。`,
      `可用 --separator / --separator-regex 手动指定分隔符来纠正。`,
    );
  } else if (confidence === "medium") {
    warnings.push(
      `分章置信度【中】（策略：${describeStrategy(best.strategy)}）。若发现切错，用 --separator 纠正。`,
    );
  }

  // 章节长度极不均匀 → 很可能是漏切或误切
  const skew = sizeSkew(chapters);
  if (chapters.length >= 3 && skew > 20) {
    warnings.push(
      `章节长度极不均匀（最长 / 中位 = ${skew.toFixed(1)}×），可能存在漏切或误合并，建议抽查。`,
    );
  }

  return { chapters, strategy: best.strategy, confidence, score: best.score, warnings };
}

/** 分章策略的中文说明（给用户看的） */
export function describeStrategy(s: ChapterStrategy): string {
  return (
    ({
      separator: "手动分隔符",
      toc: "格式自带目录",
      "markdown-heading": "Markdown 标题",
      "cjk-novel": "中文网文章节",
      "english-chapter": "英文 Chapter/Part",
      "numeric-outline": "数字大纲编号",
      "short-line": "独占短行启发式",
      "fixed-length": "按字数均匀切（兜底）",
    }) as Record<ChapterStrategy, string>
  )[s];
}

// ─── 打分 ───────────────────────────────────────────────────

function scoreToConfidence(score: number): Confidence {
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  if (score >= 2) return "low";
  return "none";
}

/**
 * 置信度打分。
 * 维度：命中数量、间距规律性、标题长度、是否像句子、是否覆盖全文。
 */
export function scoreHeadings(headings: Heading[], textLen: number, minChapters: number): number {
  let score = 0;
  const n = headings.length;

  // 数量：命中越多越可信
  if (n >= minChapters) score += 2;
  if (n >= 6) score += 1;
  if (n >= 12) score += 1;

  // 间距规律性：变异系数越小越像「有规律的章节」
  if (n >= 3) {
    const dists: number[] = [];
    for (let i = 1; i < n; i++) dists.push(headings[i]!.offset - headings[i - 1]!.offset);
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length;
    const variance = dists.reduce((a, b) => a + (b - mean) ** 2, 0) / dists.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    if (cv < 0.5) score += 2;
    else if (cv < 0.9) score += 1;
  }

  // 标题形态：像标题（短、不以句号结尾）加分
  const titleLike = headings.filter((h) => h.title.length <= 30 && !SENTENCE_END_RE.test(h.title)).length;
  score += n > 0 ? (titleLike / n) * 2 : 0;

  // 覆盖率：首个标题靠前 + 末尾剩余不多 → 说明结构贯穿全书
  const firstOffset = headings[0]!.offset;
  const lastOffset = headings[n - 1]!.offset;
  if (firstOffset < textLen * 0.1) score += 1;
  if (textLen - lastOffset < textLen * 0.5) score += 1;

  return score;
}

// ─── 各策略实现 ─────────────────────────────────────────────

function toLines(text: string): Line[] {
  const raw = text.split("\n");
  const lines: Line[] = [];
  let start = 0;
  raw.forEach((t, index) => {
    lines.push({ text: t, start, index });
    start += t.length + 1;
  });
  return lines;
}

function regexHeadings(lines: Line[], matcher: (line: string) => string | null): Heading[] {
  const out: Heading[] = [];
  for (const line of lines) {
    const t = line.text.trim();
    if (!t || t.length > 200) continue;
    const title = matcher(t);
    if (title) out.push({ title: title.trim(), offset: line.start, line: line.index });
  }
  return out;
}

function matchTitle(line: string, re: RegExp, maxTitleChars: number): string | null {
  const m = line.match(re);
  if (!m) return null;
  // 整行作为标题；过长则说明这行是正文而不是标题
  if (line.length > maxTitleChars + 10) return null;
  // m[1] 是各策略约定的「编号前缀」，容错处理未定义的组
  const prefix = (m[1] ?? "").trim();
  const rest = (m[m.length - 1] ?? "").trim();
  if (prefix && rest) return `${prefix} ${rest}`;
  return prefix || rest || null;
}

/** 短行启发式：独占一行、长度 <30、非句号结尾、前后有空白或上句是完整句 */
export function shortLineHeadings(lines: Line[], maxLen = 30): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!;
    const t = cur.text.trim();
    if (t.length < 2 || t.length > maxLen) continue;
    if (SENTENCE_END_RE.test(t)) continue; // 以句号结尾 → 是正文不是标题
    if (/^\d+$/.test(t)) continue; // 纯数字 → 页码
    if (t.includes("。") || t.includes("，")) continue; // 含句中标点 → 正文
    if (/^[#>*\-=]/.test(t)) continue; // markdown 装饰留给其他策略

    const prev = (lines[i - 1]?.text ?? "").trim();
    // 为什么不再要求「下一行非空」：真实书籍/文档的排版几乎都是
    // 「标题 → 空行 → 正文」，原实现会把这种最常见形态全部漏掉，
    // 使 short-line 策略名存实亡（与注释意图相反）。
    // 「独占一行」由 prev 为空或上一句已完整收束来保证。
    const isolated = prev === "" || SENTENCE_END_RE.test(prev) || /[”"）)]$/.test(prev);
    if (!isolated) continue;

    out.push({ title: t, offset: cur.start, line: cur.index });
  }
  return out;
}

/** 目录驱动：把 toc 标题映射到正文行 */
export function tocHeadings(text: string, lines: Line[], toc: TocEntry[]): Heading[] {
  const out: Heading[] = [];
  let cursor = 0;
  for (const entry of toc) {
    const title = entry.title.trim();
    if (!title) continue;

    let offset = -1;
    if (typeof entry.offset === "number" && entry.offset >= cursor) {
      offset = entry.offset;
    } else {
      // 目录只给了标题没给位置：按行匹配，退化为包含匹配
      const idx = findLine(lines, title, cursor);
      if (idx >= 0) offset = lines[idx]!.start;
      else offset = text.indexOf(title, cursor);
    }
    if (offset < 0) continue;
    out.push({ title, offset, line: -1 });
    cursor = offset + title.length;
  }
  return dedupeByOffset(out);
}

function findLine(lines: Line[], title: string, fromOffset: number): number {
  for (const l of lines) {
    if (l.start < fromOffset) continue;
    if (l.text.trim() === title) return l.index;
  }
  // 退化为包含匹配
  for (const l of lines) {
    if (l.start < fromOffset) continue;
    if (l.text.includes(title)) return l.index;
  }
  return -1;
}

/** 用户分隔符（字符串或正则） */
export function separatorHeadings(text: string, separator: string, isRegex: boolean): Heading[] {
  const out: Heading[] = [];
  if (isRegex) {
    let re: RegExp;
    try {
      re = new RegExp(separator, "gm");
    } catch {
      throw new Error(`--separator 不是合法正则：${separator}`);
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const lineEnd = text.indexOf("\n", m.index);
      const title = text.slice(m.index, lineEnd === -1 ? text.length : lineEnd).trim();
      out.push({ title: title || m[0].trim(), offset: m.index, line: -1 });
    }
    return dedupeByOffset(out);
  }

  let from = 0;
  while (true) {
    const idx = text.indexOf(separator, from);
    if (idx < 0) break;
    const lineEnd = text.indexOf("\n", idx);
    const title = text.slice(idx, lineEnd === -1 ? text.length : lineEnd).trim();
    out.push({ title, offset: idx, line: -1 });
    from = idx + separator.length;
  }
  return out;
}

// ─── 组装 ───────────────────────────────────────────────────

function dedupeByOffset(headings: Heading[]): Heading[] {
  const seen = new Set<number>();
  const out: Heading[] = [];
  for (const h of [...headings].sort((a, b) => a.offset - b.offset)) {
    if (seen.has(h.offset)) continue;
    seen.add(h.offset);
    out.push(h);
  }
  return out;
}

function buildChapters(text: string, headings: Heading[], preTitle: string): Chapter[] {
  const hs = dedupeByOffset(headings);
  const chapters: Chapter[] = [];

  // 首个标题之前的内容：够长就单独成章，否则并入第一章
  const preEnd = hs[0]?.offset ?? text.length;
  const preText = text.slice(0, preEnd);
  let startIdx = 0;
  if (preText.trim().length > 100) {
    chapters.push({
      index: 0,
      title: preTitle,
      start: 0,
      end: preEnd,
      charCount: preEnd,
    });
    startIdx = 1;
  }

  hs.forEach((h, i) => {
    const start = h.offset;
    const end = i + 1 < hs.length ? hs[i + 1]!.offset : text.length;
    chapters.push({
      index: startIdx + i,
      title: h.title.slice(0, 80) || `第 ${i + 1} 节`,
      start,
      end,
      charCount: end - start,
    });
  });

  return chapters.map((c, i) => ({ ...c, index: i }));
}

function fixedLengthChapters(text: string, targetChars: number): Chapter[] {
  const chapters: Chapter[] = [];
  const n = text.length;
  let pos = 0;
  let i = 0;
  while (pos < n) {
    let end = Math.min(n, pos + targetChars);
    if (end < n) {
      // 尽量落在段落边界，避免把一段从中间劈开
      const br = text.lastIndexOf("\n", end);
      if (br > pos + targetChars * 0.6) end = br + 1;
    } else {
      end = n;
    }
    if (end <= pos) end = Math.min(n, pos + targetChars);
    chapters.push({
      index: i++,
      title: `第 ${i} 段（按 ${targetChars} 字切分，非真实章节）`,
      start: pos,
      end,
      charCount: end - pos,
    });
    pos = end;
  }
  return chapters;
}

function sizeSkew(chapters: Chapter[]): number {
  const sizes = chapters.map((c) => c.charCount).filter((s) => s > 0).sort((a, b) => a - b);
  if (sizes.length < 3) return 0;
  const median = sizes[Math.floor(sizes.length / 2)]!;
  const max = sizes[sizes.length - 1]!;
  return median > 0 ? max / median : 0;
}

/** probe 用：章节字数分布统计 */
export function chapterSizeStats(chapters: Chapter[]): {
  count: number;
  min: number;
  max: number;
  median: number;
  total: number;
} {
  if (chapters.length === 0) return { count: 0, min: 0, max: 0, median: 0, total: 0 };
  const sizes = chapters.map((c) => c.charCount).sort((a, b) => a - b);
  return {
    count: chapters.length,
    min: sizes[0]!,
    max: sizes[sizes.length - 1]!,
    median: sizes[Math.floor(sizes.length / 2)]!,
    total: sizes.reduce((a, b) => a + b, 0),
  };
}
