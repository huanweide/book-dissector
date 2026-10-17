// ============================================================
// Provider 注册表与 context window 表
// ------------------------------------------------------------
// 为什么要有这张表：原型把「多少字符塞进一个 prompt」写死成 60000/80000，
// 换个模型就超窗。这里按模型查 context window，再反推安全的输入预算。
// ============================================================

export type ProviderId = "openai" | "siliconflow" | "deepseek" | "groq" | "custom";

export interface ProviderDef {
  id: ProviderId;
  name: string;
  baseURL: string;
  envKey: string;
  defaultModel: string;
  /** 是否稳定支持 response_format: json_object */
  jsonMode: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    jsonMode: true,
  },
  siliconflow: {
    id: "siliconflow",
    name: "SiliconFlow（硅基流动）",
    baseURL: "https://api.siliconflow.cn/v1",
    envKey: "SILICONFLOW_API_KEY",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    jsonMode: true,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    jsonMode: true,
  },
  groq: {
    id: "groq",
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    jsonMode: true,
  },
  custom: {
    id: "custom",
    name: "自定义 OpenAI 兼容端点",
    baseURL: "",
    envKey: "BOOK_DISSECTOR_API_KEY",
    defaultModel: "gpt-4o-mini",
    jsonMode: false,
  },
};

/** 精确模型 → context window（token） */
const EXACT_WINDOWS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4.1": 128_000,
  "gpt-4.1-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-3.5-turbo": 16_385,
  o1: 200_000,
  "o1-mini": 128_000,
  o3: 200_000,
  // DeepSeek
  "deepseek-chat": 65_536,
  "deepseek-reasoner": 65_536,
  // Groq
  "llama-3.3-70b-versatile": 128_000,
  "llama-3.1-70b-versatile": 131_072,
  "llama3-70b-8192": 8_192,
  "llama3-8b-8192": 8_192,
  "mixtral-8x7b-32768": 32_768,
  "gemma2-9b-it": 8_192,
  // SiliconFlow 常见
  "Qwen/Qwen2.5-72B-Instruct": 32_768,
  "Qwen/Qwen2.5-32B-Instruct": 32_768,
  "Qwen/Qwen2.5-14B-Instruct": 32_768,
  "Qwen/Qwen2.5-7B-Instruct": 32_768,
  "deepseek-ai/DeepSeek-V3": 65_536,
  "deepseek-ai/DeepSeek-R1": 65_536,
  "THUDM/glm-4-9b-chat": 32_768,
};

/** 前缀 → context window，用于未收录的同系列模型 */
const PREFIX_WINDOWS: [string, number][] = [
  ["gpt-4o", 128_000],
  ["gpt-4.1", 128_000],
  ["gpt-4", 128_000],
  ["gpt-3.5", 16_385],
  ["o1", 200_000],
  ["o3", 200_000],
  ["deepseek", 65_536],
  ["Qwen/Qwen2.5", 32_768],
  ["Qwen/Qwen3", 32_768],
  ["Qwen", 32_768],
  ["glm-4", 32_768],
  ["llama-3.3", 128_000],
  ["llama-3.1", 131_072],
  ["llama3", 8_192],
  ["mixtral", 32_768],
  ["gemma", 8_192],
];

/** provider 级兜底（未收录模型时的保守值） */
const PROVIDER_DEFAULT_WINDOW: Record<ProviderId, number> = {
  openai: 128_000,
  siliconflow: 32_768,
  deepseek: 65_536,
  groq: 8_192,
  custom: 32_768,
};

export function contextWindow(model: string, provider: ProviderId): number {
  const key = model.trim();
  if (EXACT_WINDOWS[key]) return EXACT_WINDOWS[key]!;
  const lower = key.toLowerCase();
  for (const [prefix, win] of PREFIX_WINDOWS) {
    if (lower.startsWith(prefix.toLowerCase())) return win;
  }
  return PROVIDER_DEFAULT_WINDOW[provider];
}

/** 预留给输出 + 系统提示的安全余量 */
const RESERVE_OUTPUT = 4096;
const RESERVE_SYSTEM = 1024;
/** 单 chunk 上限：再大也没必要，且单次请求延迟过高 */
const CHUNK_CAP = 24_000;
const CHUNK_FLOOR = 1_200;

/**
 * 默认 token 预算 = context window - 输出预留 - 系统提示预留，再夹到 [1200, 24000]。
 * 为什么留这么大的余量：模型侧计算 token 的方式和我们不同，宁可保守也不要 400 超窗。
 */
export function defaultTokenBudget(model: string, provider: ProviderId): number {
  const win = contextWindow(model, provider);
  const budget = win - RESERVE_OUTPUT - RESERVE_SYSTEM;
  return Math.max(CHUNK_FLOOR, Math.min(CHUNK_CAP, budget));
}

export function resolveProvider(id: string | undefined): ProviderDef {
  if (!id) return PROVIDERS.deepseek;
  const key = id.toLowerCase() as ProviderId;
  return PROVIDERS[key] ?? PROVIDERS.custom;
}
