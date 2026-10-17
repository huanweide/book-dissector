// ============================================================
// 重试与错误分类
// ------------------------------------------------------------
// 原型的问题：catch{} 静默吞错 + 并发硬编码 8 + 无退避，
// 用户看到满屏 ❌ 却不知道是限流还是超窗还是内容被过滤。
// 这里把每一种失败都归类成 FailureReason 并向上透出。
// ============================================================

import type { FailureReason } from "../types.js";

export class LLMError extends Error {
  /** 429 响应里 Retry-After 给出的等待建议（毫秒） */
  hintMs?: number;

  constructor(
    readonly reason: FailureReason,
    message: string,
    readonly status?: number,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/** 各类失败的用户可读建议（绝不只甩一个 ❌） */
export const FAILURE_ADVICE: Record<FailureReason, string> = {
  rate_limit: "触发限流（429）。降低 --map-workers，或换更宽松的 provider。",
  server_error: "服务端 5xx。已重试，若持续失败请稍后再试或换 provider。",
  context_overflow: "超出上下文窗口。减小 --token-budget 后重试。",
  content_filter: "命中内容过滤。可换模型或自行裁剪敏感片段。",
  auth: "鉴权失败。检查 API Key 是否正确、provider 是否匹配。",
  network: "网络异常。检查代理/网络，或设置 BOOK_DISSECTOR_BASE_URL。",
  schema_invalid: "模型返回的结构不符合模板 schema。已尝试修复一次。",
  parse_error: "模型返回的不是合法 JSON。建议使用 json mode 更好的模型。",
  unknown: "未知错误。",
};

/** 是否值得重试 */
export function isRetryable(reason: FailureReason): boolean {
  return reason === "rate_limit" || reason === "server_error" || reason === "network";
}

/** 把 HTTP 状态 / 错误信息归类为 FailureReason */
export function classifyHttp(status: number, body: string): FailureReason {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_error";
  if (status === 400 || status === 413 || status === 422) {
    const lower = body.toLowerCase();
    if (
      lower.includes("context") ||
      lower.includes("too long") ||
      lower.includes("maximum context") ||
      lower.includes("token") ||
      lower.includes("length")
    ) {
      return "context_overflow";
    }
    if (lower.includes("content_filter") || lower.includes("safety") || lower.includes("filtered")) {
      return "content_filter";
    }
  }
  return "unknown";
}

export interface RetryOptions {
  /** 最大重试次数（不含首次请求） */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 可注入的 sleep，方便单测不真睡 */
  sleep?: (ms: number) => Promise<void>;
  /** 每次重试前的回调，用于打印进度 */
  onRetry?: (info: { attempt: number; reason: FailureReason; delayMs: number; error: Error }) => void;
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数退避重试（带抖动）。
 * 429 优先遵循响应里的 Retry-After（通过 error 上的 hintMs 传递）。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const max = opts.maxDelayMs ?? 30_000;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      const llmErr = e instanceof LLMError ? e : new LLMError("unknown", String(e));
      if (attempt >= retries || !llmErr.retryable) throw llmErr;

      // 指数退避 + 抖动（抖动避免多个并发请求同时重试造成二次尖峰）
      // 429 时优先听服务端 Retry-After 的建议
      const hint = llmErr.hintMs;
      const expo = Math.min(max, base * 2 ** attempt);
      const jitter = Math.random() * base * 0.5;
      const delayMs = Math.min(max, Math.round((hint ?? expo) + jitter));

      opts.onRetry?.({ attempt: attempt + 1, reason: llmErr.reason, delayMs, error: llmErr });
      await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
