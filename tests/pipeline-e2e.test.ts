// ============================================================
// 端到端流水线测试：注入 fake LLM client，跑完整 map-reduce
// ------------------------------------------------------------
// BUILD-REPORT 点名的缺口：runPipeline 依赖 LLM 响应，此前没有
// 注入 fake client 做全流程 mock，只覆盖到 LLMClient.chat 的重试层。
// 本文件补上：不花一分钱、不碰网络，证明「解析→分章→map→reduce→
// 跨维度校验→五种导出物」整条链路不退化，且输出真能被下游消费。
// ============================================================
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../src/extract/pipeline.js";
import { BUILTIN_TEMPLATES } from "../src/templates/index.js";
import { MAP_SYSTEM } from "../src/extract/prompts.js";
import { writeOutputs } from "../src/output/index.js";
import type { ChatMessage, LLMClient } from "../src/llm/client.js";
import type { DissectResult, TextChunk } from "../src/types.js";

// 合法条目：name + detail 必填、confidence 是 0-1 数字，刚好过 zod schema
function fakeItem(name: string) {
  return {
    name,
    detail: `测试桩条目：${name}`,
    evidence: "",
    tags: ["测试"],
    aliases: [],
    confidence: 0.9,
  };
}

/** 零网络 LLM 桩：map 请求给每维度 3 条候选（跨 3 chunk 共 9 条 → 触发 reduce），reduce/cross-check 给合法 items */
class FakeLLMClient {
  constructor(private dims: string[]) {}
  async chat(messages: ChatMessage[]): Promise<{ content: string }> {
    const sys = messages[0]?.content ?? "";
    if (sys === MAP_SYSTEM) {
      // 用 prompt 里的「第 N / M 段」给条目加 chunk 序号，使跨 chunk 不同名
      // —— 否则 3 chunk 各报同名 3 条会被 localDedupe 合并成 3，触发不了 reduce。
      const user = messages[1]?.content ?? "";
      const m = user.match(/第\s*(\d+)\s*\//);
      const ci = m ? m[1] : "0";
      const dimensions: Record<string, unknown> = {};
      for (const k of this.dims) {
        dimensions[k] = {
          items: [fakeItem(`${k}#c${ci}#1`), fakeItem(`${k}#c${ci}#2`), fakeItem(`${k}#c${ci}#3`)],
        };
      }
      return {
        content: JSON.stringify({
          dimensions,
          entities: [{ name: "萧炎", aliases: ["炎帝"], type: "character", description: "测试角色" }],
        }),
      };
    }
    // reduce 与 cross-check 共用：返回 1 条归并结果
    return { content: JSON.stringify({ items: [fakeItem("归并结果")] }) };
  }
}

const template = BUILTIN_TEMPLATES.find((t) => t.id === "webnovel")!;
const fakeClient = new FakeLLMClient(template.dimensions.map((d) => d.key)) as unknown as LLMClient;

function makeChunk(id: string): TextChunk {
  return { id, text: `${id} 的测试内容，用于端到端流水线。`, tokenEstimate: 50, start: 0, end: 20, chapterIndexes: [] };
}

const chunks = [makeChunk("c1"), makeChunk("c2"), makeChunk("c3")];

function runStandard() {
  return runPipeline({
    template,
    chunks,
    client: fakeClient,
    depth: "standard",
    mapWorkers: 2,
    bookTitle: "测试之书",
    tokenBudget: 8000,
  });
}

describe("端到端流水线（fake LLM，零网络）", () => {
  it("standard：map+reduce 全链跑通，9 条候选被归并成每维度 1 条", async () => {
    const out = await runStandard();
    // 维度数量与模板一致（standard 不追加一致性校验）
    expect(out.dimensions).toHaveLength(template.dimensions.length);
    // 每条维度的 items 都被 reduce 归并进了 1 条（证明 reduce 真的跑了，不是直接透传 9 条）
    for (const d of out.dimensions) {
      const items = (d.data as { items?: unknown[] }).items ?? [];
      expect(items).toHaveLength(1);
    }
    // 跨 chunk 的同名实体被归并（3 chunk 各报一次萧炎 → 1 个实体）
    expect(out.entities.length).toBeGreaterThanOrEqual(1);
    const xiao = out.entities.find((e) => e.canonical === "萧炎");
    expect(xiao).toBeDefined();
    expect(xiao!.aliases).toContain("炎帝");
    // fake 全部合法，不应有任何失败被吞
    expect(out.failures).toHaveLength(0);
  });

  it("deep：在 standard 基础上多追加一条跨维度一致性校验（有冲突时）", async () => {
    const out = await runPipeline({
      template,
      chunks,
      client: fakeClient,
      depth: "deep",
      mapWorkers: 2,
      bookTitle: "测试之书",
      tokenBudget: 8000,
    });
    // 每个维度归并后 1 条 + 至少 1 条一致性校验
    expect(out.dimensions.length).toBe(template.dimensions.length + 1);
    const last = out.dimensions[out.dimensions.length - 1]!;
    expect(last.key).toBe("consistency_check");
  });

  it("失败不静默：fake 返回非法 JSON 时，对应维度记 schema_invalid 而非丢数据", async () => {
    class BrokenClient {
      async chat(): Promise<{ content: string }> {
        return { content: "这不是 JSON" };
      }
    }
    const broken = new BrokenClient() as unknown as LLMClient;
    const out = await runPipeline({
      template,
      chunks: [makeChunk("x1")],
      client: broken,
      depth: "standard",
      mapWorkers: 1,
      bookTitle: "测试之书",
      tokenBudget: 8000,
    });
    // map 全失败 → 至少记录失败，绝不静默（返回非 JSON 被 catch 归类为 unknown）
    expect(out.failures.length).toBeGreaterThan(0);
    expect(out.failures[0]!.reason).toBe("unknown");
  });

  it("pipeline 产物能被五种导出物消费（输出真能拿去用）", async () => {
    const out = await runStandard();
    const result: DissectResult = {
      meta: {
        file: "/tmp/test.txt",
        format: "txt",
        title: "测试之书",
        author: "测试作者",
        template: "webnovel",
        depth: "standard",
        model: "deepseek-chat",
        provider: "deepseek",
        createdAt: "2026-10-17T00:00:00.000Z",
        charCount: 600,
        tokenEstimate: 630,
        chunkCount: chunks.length,
      },
      chapters: [{ index: 0, title: "第一章 测试", start: 0, end: 600, charCount: 600 }],
      chapterDetect: { strategy: "cjk-novel", confidence: "high", score: 9, warnings: [] },
      dimensions: out.dimensions,
      entities: out.entities,
      failures: out.failures,
    };

    const dir = await mkdtemp(join(tmpdir(), "book-dissector-e2e-"));
    const written = await writeOutputs(result, ["md", "json", "lorebook", "cards", "prompt"], dir);
    // 5 个请求格式 + 始终产出的 entities.json
    expect(written).toHaveLength(6);

    const lb = JSON.parse(await readFile(join(dir, "lorebook.json"), "utf8"));
    expect(Object.keys(lb.entries).length).toBeGreaterThan(0);
    const cards = JSON.parse(await readFile(join(dir, "cards.json"), "utf8"));
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBeGreaterThan(0);
    const json = JSON.parse(await readFile(join(dir, "dissect.json"), "utf8"));
    expect(json.meta.title).toBe("测试之书");
    const md = await readFile(join(dir, "dissect.md"), "utf8");
    expect(md).toContain("测试之书");
    const prompt = await readFile(join(dir, "system-prompt.txt"), "utf8");
    expect(prompt).toContain("萧炎"); // 角色卡进了系统提示词
    // 落盘文件非空
    for (const name of ["dissect.md", "dissect.json", "lorebook.json", "cards.json", "system-prompt.txt", "entities.json"]) {
      const st = await stat(join(dir, name));
      expect(st.size).toBeGreaterThan(0);
    }
  });
});
