// token 预算与切块边界：刚好等于上限 / 超出一个字
import { describe, expect, it } from "vitest";
import { estimateTokens, splitTextByTokens } from "../src/chunk/token.js";
import { buildChunks, sampleChunks } from "../src/chunk/splitter.js";
import type { Chapter, TextChunk } from "../src/types.js";

/** 生成 n 句、每句 9 个汉字 + 句号的语料（带句间边界，可被句子级切分） */
function sentenceCorpus(n: number): string {
  return Array.from({ length: n }, () => "一二三四五六七八九。").join("");
}

describe("estimateTokens", () => {
  it("CJK 按 1.05 高估，纯英文按词计", () => {
    expect(estimateTokens("字")).toBe(2); // ceil(1.05)
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello world")).toBe(3); // ceil(2 * 1.3)
  });
});

describe("splitTextByTokens 预算边界", () => {
  const text = sentenceCorpus(30); // 300 字
  const total = estimateTokens(text);

  it("刚好等于上限 → 原样返回单块", () => {
    const out = splitTextByTokens(text, total);
    expect(out).toHaveLength(1);
    expect(out[0]!.tokenEstimate).toBe(total);
    expect(out[0]!.tokenEstimate).toBeLessThanOrEqual(total);
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.end).toBe(text.length);
  });

  it("超出一个字的预算 → 必须切开，且每块都不超限", () => {
    const budget = total - 1;
    const out = splitTextByTokens(text, budget);
    expect(out.length).toBeGreaterThan(1);
    for (const p of out) {
      expect(p.tokenEstimate).toBeLessThanOrEqual(budget);
      expect(p.end - p.start).toBe(p.text.length);
    }
    // 切块无损：拼回去等于原文
    expect(out.map((p) => p.text).join("")).toBe(text);
  });

  it("空文本返回空数组", () => {
    expect(splitTextByTokens("   \n  ", 100)).toHaveLength(0);
  });
});

describe("buildChunks", () => {
  const mk = (index: number, start: number, end: number): Chapter => ({
    index,
    title: `第${index + 1}章`,
    start,
    end,
    charCount: end - start,
  });

  it("多个小章凑满预算合并，chapterIndexes 保留溯源", () => {
    const text = "甲".repeat(3000);
    const chapters = [mk(0, 0, 1000), mk(1, 1000, 2000), mk(2, 2000, 3000)];
    const chunks = buildChunks(text, chapters, 3000);
    // 每章 1050 tokens：第 1+2 章合并（2100 ≤ 3000），第 3 章单独
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.chapterIndexes).toEqual([0, 1]);
    expect(chunks[1]!.chapterIndexes).toEqual([2]);
    expect(chunks[0]!.tokenEstimate).toBeLessThanOrEqual(3000);
  });

  it("单章超预算 → 内部再切，绝不超窗", () => {
    const text = "甲".repeat(5000); // 5250 tokens
    const chunks = buildChunks(text, [mk(0, 0, 5000)], 3000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenEstimate).toBeLessThanOrEqual(3000);
      expect(c.chapterIndexes).toEqual([0]);
    }
  });

  it("sampleChunks 等距采样且含首尾", () => {
    const chunks: TextChunk[] = Array.from({ length: 10 }, (_, i) => ({
      id: `chunk-${i}`,
      chapterIndexes: [i],
      text: "x",
      tokenEstimate: 1,
      start: i,
      end: i + 1,
    }));
    const sampled = sampleChunks(chunks, 3);
    expect(sampled).toHaveLength(3);
    expect(sampled[0]!.id).toBe("chunk-0");
    expect(sampled[2]!.id).toBe("chunk-9");
    // 采样数 ≥ 总数时原样返回
    expect(sampleChunks(chunks, 10)).toHaveLength(10);
  });
});
