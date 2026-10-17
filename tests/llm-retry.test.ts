// LLM 客户端重试用例：429 指数退避、不可重试错误直接透出
import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "../src/llm/client.js";
import { LLMError, classifyHttp, withRetry } from "../src/llm/retry.js";

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okResponse(content: string): Response {
  return jsonResponse({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLMClient 重试", () => {
  it("前两次 429、第三次成功 → 共 3 次调用且最终成功", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls <= 2) {
        return new Response("too many requests", {
          status: 429,
          headers: { "retry-after": "0" }, // 0 表示不听从服务端建议，走指数退避
        });
      }
      return okResponse('{"ok":true}');
    });
    vi.stubGlobal("fetch", fetchMock);

    const reasons: string[] = [];
    const client = new LLMClient({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "test-key",
    });
    const res = await client.chat([{ role: "user", content: "hi" }], {
      retries: 3,
      sleep: async () => {}, // 单测不真睡
      onRetry: (i) => reasons.push(i.reason),
    });

    expect(calls).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(res.content)).toEqual({ ok: true });
    expect(res.usage?.totalTokens).toBe(2);
    expect(reasons).toEqual(["rate_limit", "rate_limit"]);
  });

  it("401 鉴权失败不可重试，只调用一次并透出 reason", async () => {
    const fetchMock = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new LLMClient({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "bad-key",
    });
    await expect(
      client.chat([{ role: "user", content: "hi" }], { retries: 3, sleep: async () => {} }),
    ).rejects.toMatchObject({ name: "LLMError", reason: "auth", status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("持续 500 重试到上限后抛出 server_error", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new LLMClient({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "test-key",
    });
    await expect(
      client.chat([{ role: "user", content: "hi" }], { retries: 1, sleep: async () => {} }),
    ).rejects.toMatchObject({ reason: "server_error" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // 首次 + 1 次重试
  });

  it("网络错误归类为 network 且可重试", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LLMClient({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "test-key",
    });
    await expect(
      client.chat([{ role: "user", content: "hi" }], { retries: 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ reason: "network" });
  });
});

describe("错误分类与退避曲线", () => {
  it("classifyHttp 覆盖各类状态码", () => {
    expect(classifyHttp(401, "")).toBe("auth");
    expect(classifyHttp(403, "")).toBe("auth");
    expect(classifyHttp(429, "")).toBe("rate_limit");
    expect(classifyHttp(503, "")).toBe("server_error");
    expect(classifyHttp(400, "maximum context length exceeded")).toBe("context_overflow");
    expect(classifyHttp(400, "content_filter triggered")).toBe("content_filter");
    expect(classifyHttp(404, "not found")).toBe("unknown");
  });

  it("withRetry 指数退避：第 n 次等待约为 base * 2^(n-1) + 抖动", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new LLMError("rate_limit", "429", 429, true);
        return "done";
      },
      {
        retries: 3,
        baseDelayMs: 1000,
        sleep: async (ms) => delays.push(ms),
      },
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
    expect(delays).toHaveLength(2);
    // 1000 + jitter(0~500) / 2000 + jitter(0~500)
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[0]).toBeLessThan(1500);
    expect(delays[1]).toBeGreaterThanOrEqual(2000);
    expect(delays[1]).toBeLessThan(2500);
  });

  it("LLMError 的 retryable 语义与 isRetryable 一致", () => {
    expect(new LLMError("rate_limit", "x", 429, true).retryable).toBe(true);
    expect(new LLMError("auth", "x", 401, false).retryable).toBe(false);
  });
});
