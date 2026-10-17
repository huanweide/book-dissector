// ============================================================
// OpenAI 兼容协议客户端（原生 fetch 手写，禁止引入 openai SDK）
// ------------------------------------------------------------
// 只做三件事：拼请求、发请求、把失败归类向上抛。
// 绝不 catch{} 吞错 —— 任何失败都以 LLMError(reason) 的形式透出。
// ============================================================

import type { ProviderId } from "./providers.js";
import { PROVIDERS, resolveProvider } from "./providers.js";
import { LLMError, classifyHttp, isRetryable, withRetry, type RetryOptions } from "./retry.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMClientConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
  /** 强制 JSON 输出（response_format: json_object） */
  jsonMode?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export interface LLMResponse {
  content: string;
  /** 用量，便于成本提示 */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export class LLMClient {
  readonly baseURL: string;
  readonly model: string;
  readonly providerId: ProviderId;

  constructor(readonly cfg: LLMClientConfig) {
    this.providerId = cfg.provider;
    const def = resolveProvider(cfg.provider);
    const raw = (cfg.baseURL ?? def.baseURL ?? "").trim();
    if (!raw) {
      throw new LLMError(
        "auth",
        `provider=${cfg.provider} 没有配置 baseURL。请传 --base-url 或设置 BOOK_DISSECTOR_BASE_URL。`,
      );
    }
    this.baseURL = raw.replace(/\/+$/, "");
    this.model = cfg.model;
  }

  async chat(messages: ChatMessage[], extra?: RetryOptions & { jsonMode?: boolean }): Promise<LLMResponse> {
    const url = `${this.baseURL}/chat/completions`;
    const jsonMode = extra?.jsonMode ?? this.cfg.jsonMode ?? true;
    const timeoutMs = this.cfg.timeoutMs ?? 180_000;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.cfg.temperature ?? 0.2,
    };
    if (this.cfg.maxTokens) body.max_tokens = this.cfg.maxTokens;
    if (jsonMode && resolveProvider(this.providerId).jsonMode !== false) {
      body.response_format = { type: "json_object" };
    }

    return withRetry(
      async () => {
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.cfg.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          // fetch only rejects on network errors —— 归类为 network 且可重试
          const msg = e instanceof Error ? e.message : String(e);
          throw new LLMError("network", `请求失败：${msg}`, undefined, true);
        }

        const text = await res.text();

        if (!res.ok) {
          const reason = classifyHttp(res.status, text);
          const err = new LLMError(
            reason,
            `HTTP ${res.status}：${truncate(text, 300)}`,
            res.status,
            isRetryable(reason),
          );
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("retry-after"));
            if (Number.isFinite(retryAfter) && retryAfter > 0) err.hintMs = retryAfter * 1000;
          }
          throw err;
        }

        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new LLMError("unknown", `响应不是合法 JSON：${truncate(text, 200)}`, res.status, false);
        }

        const content: string | undefined =
          json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text;
        if (typeof content !== "string" || content.trim() === "") {
          throw new LLMError("parse_error", "模型返回内容为空", undefined, false);
        }

        return {
          content,
          usage: json?.usage
            ? {
                promptTokens: json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens,
              }
            : undefined,
        };
      },
      {
        retries: extra?.retries ?? this.cfg.retries ?? 3,
        sleep: extra?.sleep,
        onRetry: extra?.onRetry,
      },
    );
  }
}

/** 从环境变量读取 apiKey（不写死任何真实密钥） */
export function apiKeyFromEnv(provider: ProviderId): string | undefined {
  const def = PROVIDERS[provider];
  return process.env[def.envKey] || process.env.BOOK_DISSECTOR_API_KEY || undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
