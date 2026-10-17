// 实体归并用例：萧炎 / 炎帝 / 萧家三少 → 同一个 id
import { describe, expect, it } from "vitest";
import { mergeEntities, normalizeName, shouldMerge, stripAffixes } from "../src/extract/entity-merge.js";
import type { EntityMention } from "../src/types.js";

const mention = (name: string, aliases: string[], id: string): EntityMention => ({
  name,
  aliases,
  type: "character",
  description: `${name}的描述`,
  sourceChunkId: id,
});

describe("实体归并", () => {
  it("萧炎 / 炎帝 / 萧家三少 → 同一 id", () => {
    const entities = mergeEntities([
      mention("萧炎", ["炎帝", "萧家三少"], "chunk-1"),
      mention("炎帝", [], "chunk-2"),
      mention("萧家三少", [], "chunk-3"),
      mention("药老", [], "chunk-1"),
    ]);
    expect(entities).toHaveLength(2);

    const xiao = entities.find((e) => e.canonical === "萧炎");
    expect(xiao).toBeDefined();
    expect(xiao!.id).toMatch(/^ent-\d{3}$/);
    expect(xiao!.aliases).toContain("炎帝");
    expect(xiao!.aliases).toContain("萧家三少");
    expect(xiao!.mentionCount).toBe(3);
    expect(xiao!.sourceChunkIds.sort()).toEqual(["chunk-1", "chunk-2", "chunk-3"]);

    // 别名绝不允许再单独成实体
    expect(entities.some((e) => e.canonical === "炎帝" || e.canonical === "萧家三少")).toBe(false);
    // 无关角色不受影响
    const yao = entities.find((e) => e.canonical === "药老");
    expect(yao).toBeDefined();
    expect(yao!.id).not.toBe(xiao!.id);
    // 提及多的排前面
    expect(entities[0]!.canonical).toBe("萧炎");
  });

  it("normalizeName 归一化全角/空白/括号/大小写", () => {
    expect(normalizeName("萧 炎")).toBe("萧炎");
    expect(normalizeName("萧炎（主角）")).toBe("萧炎");
    expect(normalizeName("The Great")).toBe("thegreat");
    expect(normalizeName("ＡＢＣ")).toBe("abc");
  });

  it("称谓后缀视为同一实体，无关名字不误并", () => {
    expect(stripAffixes("萧炎大帝")).toBe("萧炎");
    expect(shouldMerge("萧炎大哥", "萧炎")).toBe(true);
    expect(shouldMerge("萧炎", "萧炎")).toBe(true);
    expect(shouldMerge("萧炎", "药老")).toBe(false);
    expect(shouldMerge("萧", "萧炎")).toBe(false); // 单字不并，避免误伤
  });

  it("空输入与纯空白名字被过滤", () => {
    expect(mergeEntities([])).toHaveLength(0);
    expect(mergeEntities([{ name: "  ", sourceChunkId: "c1" }])).toHaveLength(0);
  });
});
