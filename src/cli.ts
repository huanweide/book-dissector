#!/usr/bin/env node
// ============================================================
// book-dissector CLI
// ------------------------------------------------------------
// 三个命令：
//   analyze <file>   解析 → 分章 → map-reduce 抽取 → 多格式导出
//   probe <file>     只探格式与章节，【不调用 LLM】，一分钱不花
//   templates        列出内置模板及其维度
// ============================================================

import { Command } from "commander";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ChapterResult, Depth, DissectResult, OutputFormat, TocEntry } from "./types.js";
import { parseFile, PdfUnsupportedError, SUPPORTED_EXTENSIONS } from "./formats/index.js";
import {
  chapterSizeStats,
  describeStrategy,
  detectChapters,
  type DetectOptions,
} from "./chunk/chapter-detector.js";
import { estimateTokens } from "./chunk/token.js";
import { buildChunks, sampleChunks } from "./chunk/splitter.js";
import { PROVIDERS, contextWindow, defaultTokenBudget, resolveProvider } from "./llm/providers.js";
import { LLMClient, apiKeyFromEnv } from "./llm/client.js";
import { FAILURE_ADVICE, LLMError } from "./llm/retry.js";
import { BUILTIN_TEMPLATES, listTemplates, resolveTemplate } from "./templates/index.js";
import { runPipeline } from "./extract/pipeline.js";
import { parseFormats, writeOutputs } from "./output/index.js";
import { loadEnvFile, firstNonEmpty } from "./util/env.js";
import { log, progress, warnBanner } from "./util/log.js";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("book-dissector")
  .description("什么书都能拆 —— 通用书籍结构化拆解 CLI")
  .version(VERSION);

// ────────────────────────────────────────────────────────────
// 公共选项
// ────────────────────────────────────────────────────────────
function withCommon(cmd: Command): Command {
  return cmd
    .option("--separator <sep>", "手动指定章节分隔符（字符串）")
    .option("--separator-regex", "把 --separator 当作正则处理")
    .option("--min-chapters <n>", "少于该章节数视为未识别", "3")
    .option("--chunk-chars <n>", "兜底均匀切分时每章目标字数", "4000");
}

// ────────────────────────────────────────────────────────────
// probe
// ────────────────────────────────────────────────────────────
withCommon(program.command("probe").argument("<file>", "书籍文件路径").description("只探格式和章节，不调用 LLM"))
  .action(async (file: string, opts) => {
    await loadEnvFile();
    const target = resolvePath(file);
    log.title(`\n== probe：${basename(target)} ==\n`);

    const doc = await parseFile(target);
    const meta = doc.meta;

    log.step(`格式：${doc.format}`);
    if (meta.encoding) {
      const flag = (meta.encodingConfidence ?? 1) < 0.6 ? "  ⚠ 置信度偏低，可能仍会乱码" : "";
      log.step(`编码检测：${meta.encoding}（置信度 ${(meta.encodingConfidence ?? 1).toFixed(2)}）${flag}`);
    }
    log.step(`书名：${meta.title ?? "(未识别)"} ｜ 作者：${meta.author ?? "(未识别)"}`);
    log.step(`字数：${doc.text.length.toLocaleString()} ｜ 估算 token：${estimateTokens(doc.text).toLocaleString()}`);
    log.step(`目录（toc）：${doc.toc && doc.toc.length > 0 ? `命中 ${doc.toc.length} 条` : "未命中"}`);

    const result = detectChapters(doc.text, detectOptions(opts, doc.toc));
    printChapterReport(result);

    // 章节字数分布
    const st = chapterSizeStats(result.chapters);
    log.step(
      `\n字数分布：共 ${st.count} 章，最小 ${st.min}，中位 ${st.median}，最大 ${st.max}，合计 ${st.total.toLocaleString()}`,
    );
    const preview = result.chapters.slice(0, 12);
    log.dim("\n前 12 章：");
    for (const c of preview) {
      log.dim(`  [${String(c.index + 1).padStart(3)}] ${String(c.charCount).padStart(6)} 字  ${c.title.slice(0, 40)}`);
    }
    if (result.chapters.length > 12) log.dim(`  … 其余 ${result.chapters.length - 12} 章省略`);

    // 分块预估（用默认预算演示）
    const budget = defaultTokenBudget("deepseek-chat", "deepseek");
    const chunks = buildChunks(doc.text, result.chapters, budget);
    log.step(`\n按默认预算 ${budget} token 切分 → ${chunks.length} 块（map 阶段需 ${chunks.length} 次调用）`);
    log.dim("\nprobe 不调用 LLM，未产生任何费用。\n");
  });

// ────────────────────────────────────────────────────────────
// templates
// ────────────────────────────────────────────────────────────
program
  .command("templates")
  .description("列出内置模板与维度")
  .option("--json", "以 JSON 输出")
  .action((opts) => {
    if (opts.json) {
      console.log(JSON.stringify(listTemplates(), null, 2));
      return;
    }
    log.title("\n== 内置模板 ==\n");
    for (const t of BUILTIN_TEMPLATES) {
      log.title(`${t.id.padEnd(12)} ${t.name}`);
      log.dim(`  ${t.description}`);
      log.dim(`  适用：${t.bestFor}`);
      log.dim(`  维度（${t.dimensions.length}）：${t.dimensions.map((d) => `${d.key}(${d.label})`).join("、")}`);
      console.log("");
    }
    log.dim("自定义模板：--template \"@custom:./my-template.json\"，JSON 见 README。\n");
  });

// ────────────────────────────────────────────────────────────
// analyze
// ────────────────────────────────────────────────────────────
program
  .command("analyze")
  .argument("<file>", "书籍文件路径")
  .description("拆解一本书并导出结构化结果")
  .option("-t, --template <id>", "模板：webnovel/tradebook/textbook/paper/screenplay 或 @custom:xxx.json", "webnovel")
  .option("-d, --depth <depth>", "深度：quick / standard / deep", "standard")
  .option("-m, --model <model>", "模型名（默认取 provider 的默认模型）")
  .option("-p, --provider <provider>", `provider：${Object.keys(PROVIDERS).join("/")}`)
  .option("--api-key <key>", "API Key（也可由环境变量提供）")
  .option("--base-url <url>", "自定义 OpenAI 兼容 baseURL")
  .option("-f, --format <formats>", "输出格式，逗号分隔：md/json/lorebook/cards/prompt", "md,json")
  .option("-o, --out <dir>", "输出目录", "out")
  .option("--token-budget <n>", "单 chunk 的 token 预算（默认按模型 context window 自动定）")
  .option("--map-workers <n>", "map 阶段并发数", "4")
  .option("--max-chunks <n>", "最多处理多少个 chunk（调试用）")
  .option("--dry-run", "只做解析与分章并打印计划，不调用 LLM")
  .option("--separator <sep>", "手动指定章节分隔符")
  .option("--separator-regex", "把 --separator 当作正则处理")
  .option("--min-chapters <n>", "少于该章节数视为未识别", "3")
  .option("--chunk-chars <n>", "兜底均匀切分时每章目标字数", "4000")
  .action(async (file: string, opts) => {
    await loadEnvFile();
    const target = resolvePath(file);

    // ── 1. 凭据与 provider ─────────────────────────────────
    const providerId = (opts.provider ?? process.env.BOOK_DISSECTOR_PROVIDER ?? "deepseek") as keyof typeof PROVIDERS;
    const def = resolveProvider(String(providerId));
    const model = firstNonEmpty(opts.model, process.env.BOOK_DISSECTOR_MODEL) ?? def.defaultModel;
    const apiKey = firstNonEmpty(opts.apiKey, process.env.BOOK_DISSECTOR_API_KEY, apiKeyFromEnv(def.id));
    const baseURL = firstNonEmpty(opts.baseUrl, process.env.BOOK_DISSECTOR_BASE_URL, def.baseURL);

    const formats: OutputFormat[] = parseFormats(opts.format);
    const template = await resolveTemplate(opts.template);
    const depth = normalizeDepth(opts.depth);
    const mapWorkers = Math.max(1, Number(opts.mapWorkers) || 4);
    const budget = Number(opts.tokenBudget) || defaultTokenBudget(model, def.id);
    const outDir = resolve(opts.out);

    log.title(`\n== book-dissector v${VERSION} ==`);
    log.dim(`文件：${target}`);
    log.dim(`模板：${template.id}（${template.name}）｜深度：${depth}`);
    log.dim(`模型：${model} @ ${def.name} ｜ context window：${contextWindow(model, def.id).toLocaleString()}`);
    log.dim(`token 预算：${budget} ｜ map 并发：${mapWorkers} ｜ 输出：${formats.join(", ")}\n`);

    // ── 2. 解析 ────────────────────────────────────────────
    log.step("解析文件…");
    const doc = await parseFile(target);
    if (doc.meta.encoding && (doc.meta.encodingConfidence ?? 1) < 0.6) {
      log.warn(`编码检测置信度偏低（${doc.meta.encoding} / ${(doc.meta.encodingConfidence ?? 0).toFixed(2)}），可能仍有乱码`);
    }
    log.ok(
      `解析完成：${doc.format} ｜ ${doc.text.length.toLocaleString()} 字 ｜ 估算 ${estimateTokens(doc.text).toLocaleString()} token` +
        (doc.toc?.length ? ` ｜ toc ${doc.toc.length} 条` : ""),
    );

    // ── 3. 分章 ────────────────────────────────────────────
    log.step("识别章节…");
    const chapterResult = detectChapters(doc.text, detectOptions(opts, doc.toc));
    printChapterReport(chapterResult);

    // ── 4. 切块 ────────────────────────────────────────────
    let chunks = buildChunks(doc.text, chapterResult.chapters, budget);
    if (opts.maxChunks) chunks = chunks.slice(0, Number(opts.maxChunks));
    const planChunks = depth === "quick" ? sampleChunks(chunks, 3) : chunks;
    log.ok(`切出 ${chunks.length} 块（本次处理 ${planChunks.length} 块，预算 ${budget} token/块）`);

    if (opts.dryRun) {
      log.step("\n--dry-run：到此为止，未调用 LLM。");
      log.dim(`  计划调用：map ${planChunks.length} 次${depth === "quick" ? " + reduce 0 次（本地归并）" : ` + reduce ${template.dimensions.length} 次`}`);
      log.dim(`  预计输入 token：约 ${planChunks.reduce((s, c) => s + c.tokenEstimate + 800, 0).toLocaleString()}`);
      return;
    }

    // ── 5. 校验凭据 ────────────────────────────────────────
    if (!apiKey) {
      throw new LLMError(
        "auth",
        `未找到 API Key。请任选一种方式提供：\n` +
          `  1) --api-key <你的key>\n` +
          `  2) 设置环境变量 ${def.envKey} 或 BOOK_DISSECTOR_API_KEY\n` +
          `  3) 复制 .env.example 为 .env 并填入（.env 已被 git 忽略）`,
      );
    }

    const client = new LLMClient({
      provider: def.id,
      model,
      apiKey,
      baseURL,
      retries: 3,
    });

    // ── 6. map-reduce ──────────────────────────────────────
    let mapDone = 0;
    let reduceDone = 0;
    log.step("\nmap 阶段：逐块抽取事实卡片…");
    const output = await runPipeline({
      template,
      chunks: planChunks,
      client,
      depth,
      mapWorkers,
      bookTitle: doc.meta.title ?? basename(target),
      tokenBudget: budget,
      onMapProgress: (d, t) => {
        mapDone = d;
        progress(d, t, "map ");
      },
      onReduceProgress: (d, t) => {
        reduceDone = d;
        progress(d, t, "reduce");
      },
      onRetry: (info) =>
        log.warn(`重试（${info.reason}）：第 ${info.attempt} 次，等待 ${(info.delayMs / 1000).toFixed(1)}s`),
      onMessage: (m) => log.dim(m),
    });
    void mapDone;
    void reduceDone;

    // ── 7. 组装结果 ────────────────────────────────────────
    const result: DissectResult = {
      meta: {
        file: target,
        format: doc.format,
        title: doc.meta.title,
        author: doc.meta.author,
        template: template.id,
        depth,
        model,
        provider: def.id,
        createdAt: new Date().toISOString(),
        charCount: doc.text.length,
        tokenEstimate: estimateTokens(doc.text),
        chunkCount: planChunks.length,
      },
      chapters: chapterResult.chapters,
      chapterDetect: {
        strategy: chapterResult.strategy,
        confidence: chapterResult.confidence,
        score: chapterResult.score,
        warnings: chapterResult.warnings,
      },
      dimensions: output.dimensions,
      entities: output.entities,
      failures: output.failures,
    };

    // ── 8. 落盘 ────────────────────────────────────────────
    await mkdir(outDir, { recursive: true });
    const written = await writeOutputs(result, formats, outDir);
    log.step("\n输出：");
    for (const w of written) log.ok(`${w.path}（${(w.bytes / 1024).toFixed(1)} KB）`);

    // ── 9. 结果摘要 ────────────────────────────────────────
    log.step("\n结果摘要：");
    for (const d of result.dimensions) {
      const n = Array.isArray((d.data as { items?: unknown[] })?.items)
        ? ((d.data as { items: unknown[] }).items.length as number)
        : 0;
      log.dim(`  ${d.label.padEnd(12)} 候选 ${String(d.cardCount).padStart(4)} → 归并后 ${n}`);
    }
    log.dim(`  实体：${result.entities.length} 个（已做别名归并）`);

    if (result.failures.length > 0) {
      log.warn(`\n有 ${result.failures.length} 处失败（已透出原因，不是静默失败）：`);
      const byReason = new Map<string, number>();
      for (const f of result.failures) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
      for (const [reason, n] of byReason) {
        const key = reason as keyof typeof FAILURE_ADVICE;
        log.warn(`  ${reason} ×${n}：${FAILURE_ADVICE[key] ?? ""}`);
      }
      const first = result.failures[0]!;
      log.dim(`  例：${first.scope} → ${first.message.slice(0, 160)}`);
    }
    console.log("");
  });

// ────────────────────────────────────────────────────────────
// 工具
// ────────────────────────────────────────────────────────────

function resolvePath(file: string): string {
  const p = resolve(file);
  if (!existsSync(p)) {
    throw new Error(
      `文件不存在：${p}\n  支持格式：${SUPPORTED_EXTENSIONS.join(" / ")}`,
    );
  }
  return p;
}

function detectOptions(
  opts: Record<string, unknown>,
  toc: TocEntry[] | undefined,
): DetectOptions {
  return {
    toc,
    separator: opts.separator as string | undefined,
    separatorIsRegex: Boolean(opts.separatorRegex),
    minChapters: Number(opts.minChapters) || 3,
    targetChars: Number(opts.chunkChars) || 4000,
  };
}

function normalizeDepth(d: string): Depth {
  const v = String(d).toLowerCase();
  if (v === "quick" || v === "standard" || v === "deep") return v;
  throw new Error(`未知深度：${d}（可选 quick / standard / deep）`);
}

function printChapterReport(result: ChapterResult): void {
  const label = { high: "高", medium: "中", low: "低", none: "无" }[result.confidence];
  log.ok(
    `分章：${result.chapters.length} 章 ｜ 策略：${describeStrategy(result.strategy)}（${result.strategy}）｜ 置信度：${result.confidence}（${label}）｜ 得分 ${result.score.toFixed(1)}`,
  );
  // 铁律：low / none 必须醒目告警，绝不假装切好了
  if (result.warnings.length > 0) warnBanner(result.warnings);
}

// ────────────────────────────────────────────────────────────
// 入口
// ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    if (e instanceof PdfUnsupportedError) {
      log.err("PDF 无法解析");
      console.error(`\n${e.message}\n`);
      process.exit(2);
    }
    if (e instanceof LLMError) {
      log.err(`${e.reason}：${e.message}`);
      const advice = FAILURE_ADVICE[e.reason];
      if (advice) console.error(`\n  ${advice}\n`);
      process.exit(1);
    }
    log.err(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

void main();
