// 编码检测用例：重点是 GBK 文件读出来不能乱码
import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { detectEncoding, isAscii, normalizeText } from "../src/formats/encoding.js";
import { parseTxt } from "../src/formats/txt.js";
import { ensureFixtures, fixture } from "./helpers.js";

beforeAll(ensureFixtures);

describe("编码检测", () => {
  it("GBK 文件读出来不乱码（断言含中文、无替换符）", async () => {
    const doc = await parseTxt(fixture("gbk.txt"));
    // GBK 字节流不是合法 UTF-8，必须落到多候选打分并选中 gb18030 系
    expect(doc.meta.encoding).toMatch(/gb18030|gbk/);
    expect(doc.text).toContain("少年站在沙丘上");
    expect(doc.text).toContain("第一章");
    expect(doc.text).not.toContain("\uFFFD");
    expect(doc.meta.encodingConfidence).toBeGreaterThan(0.5);
  });

  it("UTF-8 BOM 命中时置信度为 1 且剥掉 BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("你好世界", "utf8")]);
    const det = detectEncoding(buf);
    expect(det.encoding).toBe("utf-8");
    expect(det.bom).toBe(true);
    expect(det.confidence).toBe(1);
    expect(det.text).toBe("你好世界");
  });

  it("无 BOM 的合法 UTF-8 走严格解码快路径", () => {
    const det = detectEncoding(Buffer.from("你好世界，这是一段中文。", "utf8"));
    expect(det.encoding).toBe("utf-8");
    expect(det.bom).toBe(false);
    expect(det.confidence).toBeGreaterThanOrEqual(0.9);
    expect(det.text).toContain("你好世界");
  });

  it("纯 ASCII 直接按 utf-8 处理，避免误判成多字节编码", () => {
    const buf = Buffer.from("hello world 123");
    expect(isAscii(buf)).toBe(true);
    const det = detectEncoding(buf);
    expect(det.encoding).toBe("utf-8");
    expect(det.text).toBe("hello world 123");
  });

  it("normalizeText 统一换行并去零宽字符", () => {
    expect(normalizeText("a\r\nb\rc\u200bd")).toBe("a\nb\ncd");
  });
});
