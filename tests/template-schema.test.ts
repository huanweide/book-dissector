// 模板 schema / JSON 抽取 / provider 预算 用例
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDimensionSchema,
  extractJson,
  normalizeShape,
  parseDimensionOutput,
} from "../src/templates/base.js";
import {
  BUILTIN_TEMPLATES,
  UnknownTemplateError,
  getTemplate,
  loadCustomTemplate,
  parseCustomTemplate,
  resolveTemplate,
} from "../src/templates/index.js";
import { contextWindow, defaultTokenBudget, resolveProvider } from "../src/llm/providers.js";
import type { DimensionDef } from "../src/templates/base.js";

const charactersDim: DimensionDef = {
  key: "characters",
  label: "角色卡",
  instruction: "提取所有角色",
  fields: [{ name: "role", desc: "主角/配角/反派" }],
};

describe("每维度 zod schema", () => {
  it("合法结构通过校验", () => {
    const r = parseDimensionOutput(
      charactersDim,
      '{"characters":{"items":[{"name":"萧炎","detail":"主角","role":"主角","aliases":["炎帝"],"confidence":0.9}]}}',
    );
    expect(r.ok).toBe(true);
  });

  it("缺必填字段 → schema_invalid（不静默放过）", () => {
    const r = parseDimensionOutput(charactersDim, '{"characters":{"items":[{"detail":"没有名字"}]}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("name");
  });

  it("confidence 超出 0-1 被拒", () => {
    const schema = buildDimensionSchema(charactersDim);
    const bad = schema.safeParse({
      items: [{ name: "萧炎", detail: "主角", confidence: 1.5 }],
    });
    expect(bad.success).toBe(false);
  });

  it("裸数组 / 代码围栏 / 单对象都能容错归一化", () => {
    expect(normalizeShape([{ name: "a" }], "characters")).toEqual({ items: [{ name: "a" }] });
    expect(normalizeShape({ name: "a", detail: "b" }, "characters")).toEqual({
      items: [{ name: "a", detail: "b" }],
    });
    const fenced = parseDimensionOutput(
      charactersDim,
      '废话废话\n```json\n{"items":[{"name":"萧炎","detail":"主角"}]}\n```\n更多废话',
    );
    expect(fenced.ok).toBe(true);
  });
});

describe("extractJson", () => {
  it("抠出围栏 JSON", () => {
    expect(JSON.parse(extractJson('前言\n```json\n{"a":1}\n```\n后记'))).toEqual({ a: 1 });
  });

  it("JSON 后面的解释文字必须被截掉（回归：原实现会连废话一起返回）", () => {
    const out = extractJson('结果如下：\n{"a":1,"b":[1,2]}\n以上就是全部内容。');
    expect(JSON.parse(out)).toEqual({ a: 1, b: [1, 2] });
  });

  it("数组形态 + 尾随文字", () => {
    expect(JSON.parse(extractJson('输出：[{"a":1},{"a":2}] 完毕'))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("完全没有括号时返回原文 trim", () => {
    expect(extractJson("  没有json  ")).toBe("没有json");
  });
});

describe("模板注册表", () => {
  it("内置五套模板齐全且维度非空", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual([
      "webnovel",
      "tradebook",
      "textbook",
      "paper",
      "screenplay",
    ]);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.dimensions.length).toBeGreaterThan(3);
      for (const d of t.dimensions) expect(d.key).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    }
    expect(getTemplate("webnovel")?.name).toBe("网文 / 小说");
    expect(getTemplate("nope")).toBeNull();
  });

  it("未知模板抛 UnknownTemplateError", async () => {
    await expect(resolveTemplate("nope")).rejects.toBeInstanceOf(UnknownTemplateError);
  });

  it("@custom 从 JSON 文件加载并校验", async () => {
    const dir = await mkdtemp(join(tmpdir(), "book-dissector-tpl-"));
    const file = join(dir, "my.json");
    await writeFile(
      file,
      JSON.stringify({
        id: "recipe",
        name: "菜谱模板",
        dimensions: [
          { key: "dishes", label: "菜品", instruction: "提取菜品", fields: [{ name: "steps", desc: "步骤" }] },
        ],
      }),
    );
    const t = await resolveTemplate(`@custom:${file}`);
    expect(t.id).toBe("recipe");
    expect(t.dimensions[0]!.key).toBe("dishes");

    // 非法模板（key 不合规）必须报出可读错误
    const badFile = join(dir, "bad.json");
    await writeFile(badFile, JSON.stringify({ dimensions: [{ key: "中文维度", label: "x", instruction: "y" }] }));
    await expect(loadCustomTemplate(badFile)).rejects.toThrow(/自定义模板校验失败/);
    await expect(loadCustomTemplate(join(dir, "missing.json"))).rejects.toThrow(/读取自定义模板失败/);
    expect(() => parseCustomTemplate({ id: "x", dimensions: [] })).toThrow();
  });
});

describe("provider 与 token 预算", () => {
  it("context window：精确表 → 前缀兜底 → provider 默认", () => {
    expect(contextWindow("gpt-4o", "openai")).toBe(128_000);
    expect(contextWindow("gpt-4o-2024-08-06", "openai")).toBe(128_000); // 前缀
    expect(contextWindow("deepseek-chat", "deepseek")).toBe(65_536);
    expect(contextWindow("some-unknown-model", "groq")).toBe(8192); // provider 保守值
  });

  it("defaultTokenBudget 夹在 [1200, 24000]", () => {
    expect(defaultTokenBudget("gpt-4o", "openai")).toBe(24_000); // 上限
    expect(defaultTokenBudget("llama3-8b-8192", "groq")).toBe(8192 - 4096 - 1024);
    expect(defaultTokenBudget("deepseek-chat", "deepseek")).toBe(24_000);
    // 极小窗口也不会低于地板
    expect(defaultTokenBudget("llama3-8b-8192", "custom")).toBeGreaterThanOrEqual(1200);
  });

  it("resolveProvider 默认 deepseek，未知回落 custom", () => {
    expect(resolveProvider(undefined).id).toBe("deepseek");
    expect(resolveProvider("openai").id).toBe("openai");
    expect(resolveProvider("who").id).toBe("custom");
  });
});
