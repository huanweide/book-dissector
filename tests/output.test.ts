// 输出层用例：五种导出物各自的形态与用途
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCards,
  buildLorebook,
  parseFormats,
  renderFormat,
  renderJson,
  renderMarkdown,
  renderSystemPrompt,
  writeOutputs,
} from "../src/output/index.js";
import type { DissectResult } from "../src/types.js";

function fakeResult(confidence: "high" | "low" = "high"): DissectResult {
  return {
    meta: {
      file: "/tmp/x.txt",
      format: "txt",
      title: "测试之书",
      author: "测试作者",
      template: "webnovel",
      depth: "standard",
      model: "deepseek-chat",
      provider: "deepseek",
      createdAt: "2026-10-17T00:00:00.000Z",
      charCount: 1234,
      tokenEstimate: 1300,
      chunkCount: 2,
    },
    chapters: [{ index: 0, title: "第一章 沙漠之旅", start: 0, end: 600, charCount: 600 }],
    chapterDetect: {
      strategy: "cjk-novel",
      confidence,
      score: confidence === "high" ? 8 : 2.5,
      warnings: confidence === "high" ? [] : ["分章置信度【低】，请人工抽查几章边界。"],
    },
    dimensions: [
      {
        key: "characters",
        label: "角色卡",
        data: {
          items: [
            { name: "萧炎", detail: "主角，沙漠中的少年旅人。", aliases: ["炎帝"], tags: ["主角"] },
          ],
        },
        cardCount: 1,
      },
      {
        key: "hooks",
        label: "爽点与钩子",
        data: {
          items: [
            {
              name: "打脸",
              detail: "受辱之后暴露实力，众人震惊。",
              formula: "受辱→隐忍→暴露→震惊",
              chapter_range: "第3-7章",
            },
          ],
        },
        cardCount: 1,
      },
    ],
    entities: [
      {
        id: "ent-001",
        canonical: "萧炎",
        aliases: ["炎帝"],
        type: "character",
        descriptions: ["主角，沙漠中的少年旅人。"],
        mentionCount: 3,
        sourceChunkIds: ["chunk-1"],
      },
    ],
    failures: [],
  };
}

describe("输出格式", () => {
  it("md 报告含元信息、分章置信度与实体表", () => {
    const md = renderMarkdown(fakeResult());
    expect(md).toContain("# 测试之书");
    expect(md).toContain("模板：webnovel");
    expect(md).toContain("置信度：**high**");
    expect(md).toContain("实体表（已做别名归并，共 1 个）");
    expect(md).toContain("候选条目 1 条，归并后 1 条");
  });

  it("低置信度时 md 报告必须渲染警告块（不隐藏）", () => {
    const md = renderMarkdown(fakeResult("low"));
    expect(md).toContain("⚠ 警告");
    expect(md).toContain("请人工抽查几章边界");
  });

  it("json 全量可 round-trip", () => {
    const parsed = JSON.parse(renderJson(fakeResult())) as DissectResult;
    expect(parsed.meta.title).toBe("测试之书");
    expect(parsed.dimensions).toHaveLength(2);
    expect(parsed.entities[0]!.canonical).toBe("萧炎");
  });

  it("lorebook：实体一条 entry、每个维度各一条 entry，别名进 key", () => {
    const lb = buildLorebook(fakeResult());
    const keys = Object.keys(lb.entries);
    expect(keys).toHaveLength(3); // 1 实体 + 2 维度
    const ent = lb.entries[keys[0]!]!;
    expect(ent.key).toContain("萧炎");
    expect(ent.key).toContain("炎帝");
    expect(ent.keysecondary).toEqual(["character"]);
    expect(ent.position).toBe(0); // character → before char defs
    expect(ent.content).toContain("【萧炎】");
    const dim = lb.entries[keys[1]!]!;
    expect(dim.key).toEqual(["角色卡"]);
    expect(dim.content).toContain("萧炎");
    const dim2 = lb.entries[keys[2]!]!;
    expect(dim2.key).toEqual(["爽点与钩子"]);
    expect(dim2.content).toContain("打脸");
  });

  it("cards：实体卡 + 每个维度条目各一张卡，可直接粘贴", () => {
    const cards = buildCards(fakeResult());
    expect(cards).toHaveLength(3); // 1 实体卡 + 2 维度条目卡
    const ent = cards[0]!;
    expect(ent.kind).toBe("entity");
    expect(ent.title).toBe("萧炎");
    expect(ent.aliases).toEqual(["炎帝"]);
    expect(ent.markdown).toContain("# 萧炎");
    const item = cards.find((c) => c.title === "打脸")!;
    expect(item.kind).toBe("dimension-item");
    expect(item.markdown).toContain("受辱之后暴露实力");
  });

  it("prompt：可注入写作 AI 的系统提示词（核心卖点）", () => {
    const p = renderSystemPrompt(fakeResult());
    expect(p).toContain("深谙《测试之书》");
    expect(p).toContain("# 人物（务必保持人设不崩）");
    expect(p).toContain("萧炎");
    expect(p).toContain("炎帝");
    expect(p).toContain("# 爽点与钩子");
    expect(p).toContain("受辱→隐忍→暴露→震惊");
    expect(p).toContain("# 铁律");
    expect(p).toContain("# 输出要求");
    expect(p).toContain("book-dissector 从《测试之书》自动拆解生成");
    expect(p).toContain("置信度：high");
  });

  it("parseFormats 校验、去重与报错", () => {
    expect(parseFormats("md,json")).toEqual(["md", "json"]);
    expect(parseFormats("md,MD,json")).toEqual(["md", "json"]);
    expect(() => parseFormats("xml")).toThrow(/未知输出格式/);
    expect(() => parseFormats(",")).toThrow(/请至少指定一种输出格式/);
  });

  it("renderFormat 五种格式都能渲染且非空", () => {
    const r = fakeResult();
    for (const f of ["md", "json", "lorebook", "cards", "prompt"] as const) {
      expect(renderFormat(r, f).length).toBeGreaterThan(0);
    }
  });

  it("writeOutputs 落盘全部请求格式 + 实体表", async () => {
    const dir = await mkdtemp(join(tmpdir(), "book-dissector-test-"));
    const written = await writeOutputs(fakeResult(), ["md", "json", "prompt"], dir);
    expect(written).toHaveLength(4); // 3 个请求格式 + entities.json
    for (const name of ["dissect.md", "dissect.json", "system-prompt.txt", "entities.json"]) {
      const st = await stat(join(dir, name));
      expect(st.size).toBeGreaterThan(0);
    }
    expect(await readFile(join(dir, "system-prompt.txt"), "utf8")).toContain("# 铁律");
  });
});
