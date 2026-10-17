// 测试公共辅助：fixtures 路径 + 缺失时自动生成
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const FIXTURES_DIR = join(process.cwd(), "tests", "fixtures");

const REQUIRED = [
  "gbk.txt",
  "plain-continuous.txt",
  "novel-cn.txt",
  "novel-en.txt",
  "outline.md",
  "outline-numeric.txt",
  "shortline.txt",
  "sample.srt",
  "sample.epub",
  "sample.docx",
];

/** fixtures 缺失时现场跑 scripts/gen-fixtures.mjs，保证 `npx vitest run` 独立可用 */
export function ensureFixtures(): void {
  if (REQUIRED.every((f) => existsSync(join(FIXTURES_DIR, f)))) return;
  execFileSync(process.execPath, [join(process.cwd(), "scripts", "gen-fixtures.mjs")], {
    stdio: "inherit",
  });
}

export function fixture(name: string): string {
  return join(FIXTURES_DIR, name);
}
