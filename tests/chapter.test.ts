// 分章引擎用例：六种策略各一个 + 无章节号铁律 + 手动分隔符
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { detectChapters } from "../src/chunk/chapter-detector.js";
import { parseMarkdown } from "../src/formats/md.js";
import { parseEpub } from "../src/formats/epub.js";
import { parseTxt } from "../src/formats/txt.js";
import { ensureFixtures, fixture } from "./helpers.js";

beforeAll(ensureFixtures);

async function readTxt(name: string): Promise<string> {
  return (await parseTxt(fixture(name))).text;
}

describe("六种分章策略", () => {
  it("策略一：中文第X章（cjk-novel）", async () => {
    const r = detectChapters(await readTxt("novel-cn.txt"));
    expect(r.strategy).toBe("cjk-novel");
    expect(r.chapters).toHaveLength(4);
    expect(r.confidence).toBe("high");
    expect(r.chapters[0]?.title).toContain("第一章");
  });

  it("策略二：英文 Chapter N（english-chapter，标题保留编号）", async () => {
    const r = detectChapters(await readTxt("novel-en.txt"));
    expect(r.strategy).toBe("english-chapter");
    expect(r.chapters).toHaveLength(4);
    // 回归用例：原正把编号拆到第二组，标题会退化成 "Chapter" 丢失 "1"
    expect(r.chapters[0]?.title).toContain("Chapter 1");
    expect(r.chapters[0]?.title).toContain("The Desert");
  });

  it("策略三：Markdown 井号标题（markdown-heading）", async () => {
    const r = detectChapters(await readTxt("outline.md"));
    expect(r.strategy).toBe("markdown-heading");
    expect(r.chapters).toHaveLength(6);
    expect(r.confidence).toBe("high");
  });

  it("策略四：数字大纲行（numeric-outline）", async () => {
    const r = detectChapters(await readTxt("outline-numeric.txt"));
    expect(r.strategy).toBe("numeric-outline");
    expect(r.chapters).toHaveLength(5);
    expect(r.chapters[0]?.title).toContain("引言");
  });

  it("策略五：独占短行启发式（short-line）", async () => {
    const r = detectChapters(await readTxt("shortline.txt"));
    expect(r.strategy).toBe("short-line");
    expect(r.chapters).toHaveLength(5);
    expect(r.chapters[0]?.title).toBe("沙漠之旅");
  });

  it("策略六：格式自带目录驱动（toc，epub NCX）", async () => {
    const doc = await parseEpub(await readFile(fixture("sample.epub")));
    const r = detectChapters(doc.text, { toc: doc.toc });
    expect(r.strategy).toBe("toc");
    expect(r.chapters).toHaveLength(3);
    expect(r.confidence).toBe("high");
  });

  it("toc 驱动同样适用于 md 解析器产出的标题目录", async () => {
    const doc = await parseMarkdown(fixture("outline.md"));
    const r = detectChapters(doc.text, { toc: doc.toc });
    expect(r.strategy).toBe("toc");
    expect(r.chapters).toHaveLength(6);
  });
});

describe("铁律：认不出章节时必须报警，而不是假装切好", () => {
  it("无章节号的连续文本 → confidence === 'none' 且带警告", async () => {
    const r = detectChapters(await readTxt("plain-continuous.txt"));
    expect(r.confidence).toBe("none");
    expect(r.strategy).toBe("fixed-length");
    expect(r.chapters.length).toBeGreaterThan(0); // 仍给出可用的兜底切块
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.join("\n")).toContain("separator");
    expect(r.warnings.join("\n")).toContain("未能识别");
    // 兜底切块的标题必须自认不是真实章节
    expect(r.chapters[0]?.title).toContain("非真实章节");
  });
});

describe("手动分隔符", () => {
  it("--separator 优先于一切自动策略", async () => {
    const r = detectChapters(await readTxt("novel-cn.txt"), { separator: "第" });
    expect(r.strategy).toBe("separator");
    expect(r.chapters).toHaveLength(4);
    expect(r.confidence).toBe("high");
  });

  it("正则分隔符命中不足 minChapters 时降为 medium 并告警", async () => {
    const r = detectChapters(await readTxt("novel-cn.txt"), {
      separator: "^第三章",
      separatorIsRegex: true,
    });
    expect(r.strategy).toBe("separator");
    expect(r.confidence).toBe("medium");
    expect(r.warnings.join("\n")).toContain("手动分隔符只切出 1 段");
  });
});
