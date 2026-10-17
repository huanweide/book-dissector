// probe 命令不调用 LLM：mock fetch 断言调用次数为 0
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { probeFile } from "../src/formats/index.js";
import { detectChapters } from "../src/chunk/chapter-detector.js";
import { ensureFixtures, fixture } from "./helpers.js";

beforeAll(ensureFixtures);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probe 不调用 LLM", () => {
  it("txt：解析 + 分章全流程零网络调用", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { format, doc } = await probeFile(fixture("novel-cn.txt"));
    expect(format).toBe("txt");
    expect(doc.text.length).toBeGreaterThan(0);

    const r = detectChapters(doc.text);
    expect(r.chapters.length).toBeGreaterThan(0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls).toHaveLength(0);
  });

  it("epub：probe 取到 toc 也零网络调用", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { format, doc } = await probeFile(fixture("sample.epub"));
    expect(format).toBe("epub");
    expect(doc.toc?.length).toBe(3);

    const r = detectChapters(doc.text, { toc: doc.toc });
    expect(r.strategy).toBe("toc");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
