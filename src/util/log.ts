// ============================================================
// 终端输出工具
// ------------------------------------------------------------
// 为什么单独一层：原型最大的体验问题是「静默」——分章切错了不吭声、
// LLM 报错被 catch{} 吞掉。这里提供 warnBanner / failure 等醒目输出，
// 让任何"不可信的中间结果"都必须显式暴露给用户。
// ============================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
} as const;

/** 是否禁用颜色（无 TTY / NO_COLOR / CI） */
export const noColor =
  process.env.NO_COLOR === "1" || process.env.CI === "true" || !process.stdout.isTTY;

function paint(color: keyof typeof C, s: string): string {
  return noColor ? s : `${C[color]}${s}${C.reset}`;
}

export const log = {
  info: (s: string) => console.log(s),
  dim: (s: string) => console.log(paint("dim", s)),
  step: (s: string) => console.log(paint("cyan", `▸ ${s}`)),
  ok: (s: string) => console.log(paint("green", `✓ ${s}`)),
  warn: (s: string) => console.log(paint("yellow", `⚠ ${s}`)),
  err: (s: string) => console.error(paint("red", `✗ ${s}`)),
  title: (s: string) => console.log(paint("bold", s)),
};

/**
 * 醒目警告横幅。
 * 铁律：confidence 为 low/none 时必须调用，绝不能假装分章切好了。
 */
export function warnBanner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => visibleWidth(l)), 20) + 4;
  const bar = "═".repeat(width);
  console.log(paint("yellow", `╔${bar}╗`));
  console.log(paint("yellow", `║  ⚠  警告  ${" ".repeat(Math.max(0, width - 12))}║`));
  for (const l of lines) {
    const pad = " ".repeat(Math.max(0, width - 2 - visibleWidth(l)));
    console.log(paint("yellow", `║  ${l}${pad}║`));
  }
  console.log(paint("yellow", `╚${bar}╝`));
}

/** 分块进度条（不依赖任何进度条库） */
export function progress(done: number, total: number, label: string): void {
  const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
  const filled = Math.round((pct / 100) * 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  process.stdout.write(`\r${paint("cyan", `▸ ${label} ${bar} ${done}/${total} (${pct}%)`)}`);
  if (done >= total) process.stdout.write("\n");
}

/** 中文字符按 2 宽计算，避免横幅错位 */
function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // CJK / 全角区间
    w +=
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6))
        ? 2
        : 1;
  }
  return w;
}
