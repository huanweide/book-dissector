// 格式解析用例：epub / docx / srt / md / pdf 降级 / 入口分发
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { parseEpub } from "../src/formats/epub.js";
import { parseDocx } from "../src/formats/docx.js";
import { parseSrt } from "../src/formats/srt.js";
import { parseMarkdown } from "../src/formats/md.js";
import { parsePdf, PdfUnsupportedError } from "../src/formats/pdf.js";
import { detectFormat, parseFile } from "../src/formats/index.js";
import { ensureFixtures, fixture } from "./helpers.js";

beforeAll(ensureFixtures);

describe("epub 解析", () => {
  it("能取到正文、元信息与 NCX 目录（含回填偏移）", async () => {
    const doc = await parseEpub(await readFile(fixture("sample.epub")));
    expect(doc.format).toBe("epub");
    expect(doc.meta.title).toBe("测试之书");
    expect(doc.meta.author).toBe("测试作者");
    expect(doc.text).toContain("少年站在沙丘上");
    expect(doc.text).toContain("一个白发老人从阴影中走出");
    expect(doc.toc).toHaveLength(3);
    expect(doc.toc?.[0]?.title).toBe("第一章 沙漠之旅");
    expect(doc.toc?.[2]?.title).toBe("第三章 神秘老人");
    expect(typeof doc.toc?.[0]?.offset).toBe("number");
  });
});

describe("docx 解析", () => {
  it("能取到正文与标题样式目录", async () => {
    const doc = await parseDocx(await readFile(fixture("sample.docx")));
    expect(doc.format).toBe("docx");
    expect(doc.text).toContain("这是第一段正文，用于验证 docx 解析器能取到文本内容。");
    expect(doc.meta.title).toBe("拆解测试文档");
    expect(doc.toc).toHaveLength(2);
    expect(doc.toc?.[0]).toMatchObject({ title: "拆解测试文档", level: 1 });
    expect(doc.toc?.[1]).toMatchObject({ title: "小节标题", level: 2 });
  });
});

describe("srt 解析", () => {
  it("剥掉序号与时间轴，只留对白文本", async () => {
    const doc = await parseSrt(fixture("sample.srt"));
    expect(doc.format).toBe("srt");
    expect(doc.text).toContain("少年站在沙丘上");
    expect(doc.text).toContain("风沙掩埋了来时的路");
    expect(doc.text).not.toContain("00:00");
    expect(doc.text).not.toMatch(/^\d+$/m);
  });
});

describe("md 解析", () => {
  it("井号标题进 toc，首个一级标题作为书名", async () => {
    const doc = await parseMarkdown(fixture("outline.md"));
    expect(doc.format).toBe("md");
    expect(doc.meta.title).toBe("测试文档");
    expect(doc.toc).toHaveLength(6);
    expect(doc.toc?.[0]).toMatchObject({ title: "测试文档", level: 1 });
    expect(doc.toc?.[1]).toMatchObject({ title: "第一章 概述", level: 2 });
    expect(typeof doc.toc?.[0]?.offset).toBe("number");
  });
});

describe("格式入口", () => {
  it("按扩展名分发，不认识的格式抛出带建议的错误", async () => {
    expect(detectFormat("a.txt")).toBe("txt");
    expect(detectFormat("a.MD")).toBe("md");
    expect(detectFormat("a.epub")).toBe("epub");
    expect(() => detectFormat("a.mobi")).toThrow(/不支持的文件格式/);
    const doc = await parseFile(fixture("gbk.txt"));
    expect(doc.format).toBe("txt");
    expect(doc.text).toContain("少年");
  });

  it("PDF 无法解析时抛出可识别的 PdfUnsupportedError（不崩堆栈）", async () => {
    await expect(parsePdf(Buffer.from("this is not a pdf"))).rejects.toBeInstanceOf(PdfUnsupportedError);
  });
});
