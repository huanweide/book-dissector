// ============================================================
// map-reduce 抽取流水线
// ------------------------------------------------------------
// 原型：把整本书（6~8 万字符）塞进一个 prompt，deep 模式 15 维再重复发 15 次。
// 本实现：
//   map    —— 每个 chunk 独立调一次，一次覆盖所有维度（全文只过一遍）
//   reduce —— 每维度把候选条目归并（不再喂原文，成本与原书长度解耦）
//   补偿   —— 失败的 chunk 进串行队列重跑；超窗的自动对半再切
//   透出   —— 任何失败都记 FailureRecord(reason)，绝不静默
// ============================================================

import type {
  Depth,
  DimensionResult,
  EntityMention,
  FactCard,
  FailureRecord,
  MergedEntity,
  TextChunk,
} from "../types.js";
import { LLMError } from "../llm/retry.js";
import type { LLMClient } from "../llm/client.js";
import { runPool } from "../util/pool.js";
import { mergeEntities, normalizeName } from "./entity-merge.js";
import type { DimensionDef, TemplateDef } from "../templates/base.js";
import { itemsOf, normalizeShape, parseDimensionOutput } from "../templates/base.js";
import { extractJson } from "../templates/base.js";
import {
  MAP_SYSTEM,
  REDUCE_SYSTEM,
  buildMapPrompt,
  buildReducePrompt,
} from "./prompts.js";
import { splitTextByTokens } from "../chunk/token.js";

export interface PipelineOptions {
  template: TemplateDef;
  chunks: TextChunk[];
  client: LLMClient;
  depth: Depth;
  mapWorkers: number;
  bookTitle: string;
  tokenBudget: number;
  onMapProgress?: (done: number, total: number) => void;
  onReduceProgress?: (done: number, total: number) => void;
  onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void;
  onMessage?: (msg: string) => void;
}

export interface PipelineOutput {
  dimensions: DimensionResult[];
  entities: MergedEntity[];
  failures: FailureRecord[];
  cards: FactCard[];
}

interface ChunkOutcome {
  chunk: TextChunk;
  cards: Map<string, Record<string, unknown>[]>;
  entities: EntityMention[];
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineOutput> {
  const failures: FailureRecord[] = [];
  // 为什么只取 template/depth：client / bookTitle 在本函数体内并不直接使用
  // （mapChunk / reduceDimension 通过 opts 访问），解构出来会触发 noUnusedLocals。
  const { template, depth } = opts;
  const dims = template.dimensions;

  // ── map ────────────────────────────────────────────────────
  const outcomes: ChunkOutcome[] = [];
  const failedChunks: { chunk: TextChunk; reason: string }[] = [];

  await runPool(
    opts.chunks,
    opts.mapWorkers,
    async (chunk, index) => {
      try {
        const outcome = await mapChunk(opts, chunk, index, dims);
        outcomes.push(outcome);
      } catch (e) {
        const llmErr = e instanceof LLMError ? e : null;
        const reason = llmErr?.reason ?? "unknown";
        failures.push({
          scope: `map:${chunk.id}`,
          reason,
          message: llmErr?.message ?? (e instanceof Error ? e.message : String(e)),
          retries: 0,
        });
        failedChunks.push({ chunk, reason });
      }
    },
    opts.onMapProgress,
  );

  // ── 串行补偿队列 ──────────────────────────────────────────
  if (failedChunks.length > 0) {
    opts.onMessage?.(
      `${failedChunks.length} 个片段失败，进入串行补偿队列重跑（超窗的会自动对半再切）…`,
    );
    for (const { chunk, reason } of failedChunks) {
      // 超窗 → 对半切后再试，而不是原样重发（原样重发必然再超窗）
      const pieces =
        reason === "context_overflow"
          ? splitTextByTokens(chunk.text, Math.floor(opts.tokenBudget / 2), chunk.start).map((p, i) => ({
              ...chunk,
              id: `${chunk.id}-half${i + 1}`,
              text: p.text,
              tokenEstimate: p.tokenEstimate,
              start: p.start,
              end: p.end,
            }))
          : [chunk];

      for (const piece of pieces) {
        try {
          const outcome = await mapChunk(opts, piece, 0, dims);
          outcomes.push(outcome);
        } catch (e2) {
          const llmErr2 = e2 instanceof LLMError ? e2 : null;
          failures.push({
            scope: `compensate:${piece.id}`,
            reason: llmErr2?.reason ?? "unknown",
            message: llmErr2?.message ?? (e2 instanceof Error ? e2.message : String(e2)),
            retries: 1,
          });
        }
      }
    }
  }

  // ── reduce ────────────────────────────────────────────────
  const allCards: FactCard[] = [];
  const entityMentions: EntityMention[] = [];

  for (const outcome of outcomes) {
    entityMentions.push(...outcome.entities);
    for (const [dimKey, items] of outcome.cards) {
      for (const item of items) {
        allCards.push({ dimension: dimKey, data: item, sourceChunkId: outcome.chunk.id });
      }
    }
  }

  // 实体型维度里的条目也算实体提及（角色卡/概念/案例…）
  for (const dim of dims) {
    if (!dim.entityKind) continue;
    for (const card of allCards.filter((c) => c.dimension === dim.key)) {
      const data = card.data as Record<string, unknown>;
      const name = typeof data.name === "string" ? data.name : "";
      if (!name) continue;
      entityMentions.push({
        name,
        aliases: Array.isArray(data.aliases) ? (data.aliases as string[]) : [],
        type: dim.entityKind,
        description: typeof data.detail === "string" ? data.detail : "",
        sourceChunkId: card.sourceChunkId,
      });
    }
  }

  const entities = mergeEntities(entityMentions);

  // 按维度聚合候选条目
  const byDim = new Map<string, Record<string, unknown>[]>();
  for (const dim of dims) byDim.set(dim.key, []);
  for (const card of allCards) {
    const list = byDim.get(card.dimension);
    if (list) list.push(card.data as Record<string, unknown>);
  }

  const dimensionResults: DimensionResult[] = [];
  let reduceDone = 0;
  const reduceConcurrency = Math.max(1, Math.min(4, dims.length));

  await runPool(
    dims,
    reduceConcurrency,
    async (dim) => {
      const candidates = byDim.get(dim.key) ?? [];
      const merged = await reduceDimension(opts, dim, candidates, failures);
      dimensionResults.push({
        key: dim.key,
        label: dim.label,
        data: { items: merged },
        cardCount: candidates.length,
      });
      reduceDone++;
      opts.onReduceProgress?.(reduceDone, dims.length);
    },
    undefined,
  );
  dimensionResults.sort((a, b) => dims.findIndex((d) => d.key === a.key) - dims.findIndex((d) => d.key === b.key));

  // deep：一次交叉一致性校验，找出跨维度互相矛盾的地方
  if (depth === "deep" && dimensionResults.length > 0) {
    const conflicts = await crossCheck(opts, dimensionResults, failures);
    if (conflicts.length > 0) {
      dimensionResults.push({
        key: "consistency_check",
        label: "跨维度一致性校验",
        data: { items: conflicts },
        cardCount: conflicts.length,
      });
    }
  }

  return { dimensions: dimensionResults, entities, failures, cards: allCards };
}

// ─── map 单块 ────────────────────────────────────────────────

async function mapChunk(
  opts: PipelineOptions,
  chunk: TextChunk,
  index: number,
  dims: DimensionDef[],
): Promise<ChunkOutcome> {
  const total = opts.chunks.length;
  const user = buildMapPrompt(opts.template, dims, chunk, index, total, opts.bookTitle);

  const res = await opts.client.chat(
    [
      { role: "system", content: MAP_SYSTEM },
      { role: "user", content: user },
    ],
    {
      jsonMode: true,
      onRetry: (info) =>
        opts.onRetry?.({ attempt: info.attempt, reason: info.reason, delayMs: info.delayMs }),
    },
  );

  let json: unknown;
  try {
    json = JSON.parse(extractJson(res.content));
  } catch {
    // 一次修复机会：明确要求只输出 JSON
    const repair = await opts.client.chat(
      [
        { role: "system", content: MAP_SYSTEM },
        { role: "user", content: user },
        { role: "assistant", content: res.content.slice(0, 2000) },
        { role: "user", content: "你上一条输出不是合法 JSON。请只输出 JSON 对象，不要任何额外文字。" },
      ],
      { jsonMode: true },
    );
    json = JSON.parse(extractJson(repair.content));
  }

  const obj = (json ?? {}) as Record<string, unknown>;
  const dimBlock = (obj.dimensions ?? {}) as Record<string, unknown>;

  const cards = new Map<string, Record<string, unknown>[]>();
  for (const dim of dims) {
    const sub = dimBlock[dim.key];
    if (!sub) continue;
    const parsed = parseDimensionOutput(dim, JSON.stringify(sub));
    if (parsed.ok) {
      cards.set(dim.key, itemsOf(parsed.data));
    } else {
      opts.onMessage?.(`  · ${chunk.id} 的「${dim.label}」结构校验失败：${parsed.error}`);
    }
  }

  const entities: EntityMention[] = [];
  if (Array.isArray(obj.entities)) {
    for (const raw of obj.entities) {
      if (!raw || typeof raw !== "object") continue;
      const e = raw as Record<string, unknown>;
      const name = typeof e.name === "string" ? e.name.trim() : "";
      if (!name) continue;
      entities.push({
        name,
        aliases: Array.isArray(e.aliases) ? (e.aliases as string[]).filter((x) => typeof x === "string") : [],
        type: typeof e.type === "string" ? e.type : "other",
        description: typeof e.description === "string" ? e.description : "",
        sourceChunkId: chunk.id,
      });
    }
  }

  return { chunk, cards, entities };
}

// ─── reduce 单维度 ───────────────────────────────────────────

async function reduceDimension(
  opts: PipelineOptions,
  dim: DimensionDef,
  candidates: Record<string, unknown>[],
  failures: FailureRecord[],
): Promise<Record<string, unknown>[]> {
  // 本地先做一次廉价去重（按归一化名合并），这一步不花钱
  const local = localDedupe(candidates);
  if (local.length === 0) return [];

  // quick 档不调 LLM reduce（它的定位就是「最少的钱看个大概」）
  // 条目很少时也没必要再花一次调用
  if (opts.depth === "quick" || local.length <= 6) return local;

  try {
    const res = await opts.client.chat(
      [
        { role: "system", content: REDUCE_SYSTEM },
        { role: "user", content: buildReducePrompt(dim, local, opts.bookTitle) },
      ],
      { jsonMode: true },
    );
    const json = JSON.parse(extractJson(res.content));
    const normalized = normalizeShape(json, dim.key);
    const parsed = parseDimensionOutput(dim, JSON.stringify(normalized));
    if (parsed.ok) {
      const items = itemsOf(parsed.data);
      if (items.length > 0) return items;
    } else {
      failures.push({
        scope: `reduce:${dim.key}`,
        reason: "schema_invalid",
        message: parsed.error,
        retries: 1,
      });
    }
    // 走到这儿说明 LLM 归并不可用，退回本地去重结果（不丢数据）
    return local;
  } catch (e) {
    const llmErr = e instanceof LLMError ? e : null;
    failures.push({
      scope: `reduce:${dim.key}`,
      reason: llmErr?.reason ?? "unknown",
      message: llmErr?.message ?? (e instanceof Error ? e.message : String(e)),
      retries: 1,
    });
    return local;
  }
}

/** 本地廉价去重：按归一化名合并，并把 detail 拼在一起 */
export function localDedupe(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  const order: string[] = [];

  for (const item of items) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const key = name ? normalizeName(name) : `$${order.length}`;
    const exist = map.get(key);
    if (!exist) {
      map.set(key, { ...item });
      order.push(key);
      continue;
    }
    // 合并：detail 去重拼接，别名并集，其余字段取先到先得
    const prevDetail = typeof exist.detail === "string" ? exist.detail : "";
    const curDetail = typeof item.detail === "string" ? item.detail : "";
    if (curDetail && !prevDetail.includes(curDetail.slice(0, 12))) {
      exist.detail = prevDetail ? `${prevDetail}｜${curDetail}` : curDetail;
    }
    const aliases = new Set<string>();
    for (const a of [...(Array.isArray(exist.aliases) ? exist.aliases : []), ...(Array.isArray(item.aliases) ? item.aliases : [])]) {
      if (typeof a === "string" && a.trim()) aliases.add(a.trim());
    }
    if (aliases.size > 0) exist.aliases = [...aliases];
    for (const [k, v] of Object.entries(item)) {
      if (exist[k] === undefined || exist[k] === "") exist[k] = v;
    }
  }

  return order.map((k) => map.get(k)!);
}

// ─── deep：跨维度一致性校验 ──────────────────────────────────

async function crossCheck(
  opts: PipelineOptions,
  dims: DimensionResult[],
  failures: FailureRecord[],
): Promise<Record<string, unknown>[]> {
  const summary = dims
    .filter((d) => d.key !== "consistency_check")
    .map((d) => {
      const names = itemsOf(d.data)
        .slice(0, 12)
        .map((i) => (typeof i.name === "string" ? i.name : ""))
        .filter(Boolean);
      return { dimension: d.label, entries: names };
    });

  const prompt = `以下是从一本书拆解出的各维度条目摘要。请只找出【互相矛盾或明显对不上】的地方。

${JSON.stringify(summary, null, 1)}

输出 JSON：
{
  "items": [
    { "name": "冲突点简述", "detail": "具体说明哪两个维度的什么信息对不上", "evidence": "", "tags": ["冲突"], "confidence": 0.6 }
  ]
}
没有发现冲突就返回 {"items": []}。只输出 JSON。`;

  try {
    const res = await opts.client.chat(
      [
        { role: "system", content: REDUCE_SYSTEM },
        { role: "user", content: prompt },
      ],
      { jsonMode: true },
    );
    const json = JSON.parse(extractJson(res.content));
    const items = itemsOf(normalizeShape(json, "items"));
    return items.filter((i) => typeof i.name === "string" && i.name);
  } catch (e) {
    const llmErr = e instanceof LLMError ? e : null;
    failures.push({
      scope: "cross-check",
      reason: llmErr?.reason ?? "unknown",
      message: llmErr?.message ?? (e instanceof Error ? e.message : String(e)),
      retries: 0,
    });
    return [];
  }
}

/** 供输出层展示：本次抽取的规模 */
export function pipelineStats(opts: PipelineOptions): {
  chunks: number;
  estimatedPromptTokens: number;
} {
  // +800 是每块的系统提示与维度指令开销
  const promptTokens = opts.chunks.reduce((sum, c) => sum + c.tokenEstimate + 800, 0);
  return { chunks: opts.chunks.length, estimatedPromptTokens: promptTokens };
}
