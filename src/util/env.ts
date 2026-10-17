// ============================================================
// 极简 .env 加载（不引 dotenv，少一个依赖）
// ------------------------------------------------------------
// 只从 cwd 的 .env 读取，且【不覆盖】已存在的环境变量（命令行/系统优先）。
// 密钥绝不会写进任何源码文件 —— 本文件也不含任何密钥。
// ============================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadEnvFile(cwd = process.cwd()): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, ".env"), "utf8");
  } catch {
    return 0; // 没有 .env 很正常，不是错误
  }

  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    // 去掉成对引号
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = value;
    count++;
  }
  return count;
}

/** 依次尝试取第一个非空值 */
export function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}
