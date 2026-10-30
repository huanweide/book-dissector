**中文** · [README.md](./README.md)

<p align="center">
  <img src="assets/banner.svg" alt="book-dissector">
</p>

<p align="center">
  <a href="#how-it-differs-from-other-ai-book-tools">Overview</a> · <a href="#support-matrix">Capabilities</a> · <a href="#quick-start">Quick start</a> · <a href="#design-tradeoffs">Design</a> · <a href="#development">Development</a>
</p>

# book-dissector

**Turn a book into parts you can directly use.**

[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![CI](https://github.com/huanweide/book-dissector/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/book-dissector/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-68%20passed-brightgreen)](#development)

A universal book structured-dissection CLI: reads `txt / md / epub / docx / pdf / srt`, does map-reduce extraction by a token budget, and exports an md report, full json, a SillyTavern lorebook, character cards, and **a system prompt you can feed straight to a writing AI**.

Spun out and specialized from novel-smith's book-dissection module. Target users: web-novel writers, short-video script writers, note-takers, and teachers dissecting textbooks. The selling point isn't "summarizes better" — it's **output you can reuse**.

> **Suggested GitHub topics:** `cli` `typescript` `llm` `ai-writing` `map-reduce` `epub` `sillytavern` `lorebook` `webnovel` `chinese-nlp` `book-analysis` `prompt-engineering`

---

## How it differs from other AI book tools

This table is the reason this project exists. The left column is a real pitfall of the prototype (novel-smith's dissection module); the right column is this project's fix:

| # | Prototype's pitfall | This project's fix |
|---|---|---|
| 1 | Only txt/md; GBK/GB18030 Chinese web-novels turn to mojibake on read, and the garbled text is fed straight to the LLM — every later dimension silently fails and the user can't tell | Six formats + three-level encoding detection (BOM → strict UTF-8 decode → multi-candidate common-character scoring). GBK corpora score ≥0.6 on common-character ratio, mojibake ~0.1, reliably distinguished; confidence <0.6 makes the CLI warn "may still be garbled" |
| 2 | Chapter-splitting regex only recognized "第X章 / Chapter N"; <3 hits fell back to a hard 4000-char cut, while the UI silently showed "recognized N chapters" — the user never knew the split was fake. English books / textbooks / papers / scripts / modern novels without chapter numbers all degraded | Six strategies run in parallel (toc / Markdown headings / Chinese 第X章 / English Chapter / numeric outline / lone short lines) → scored by hit count, spacing regularity, heading shape, coverage → confidence rated high/medium/low/none. **When it can't recognize, it returns `confidence:'none'` + a warning banner, never a fake chapter pretending success**; `--separator` allows manual override |
| 3 | One prompt force-fed 60k–80k chars; switching models blew the window; deep mode fired all 15 dimensions over the full text, burning money on repeated transfer | Token budget reverse-derived from the model's context window (exact table + prefix fallback + conservative provider value, clamped to [1200, 24000]); map-reduce: map covers all dimensions in one call (full text scanned once), reduce feeds only candidate items, not the source (cost decoupled from book length); over-window chunks enter a serial compensation queue and auto-halve |
| 4 | Output was a free-form Markdown string: unqueryable, unvalidatable, no cross-dimension entity alignment — "Xiao Yan" / "Flame Emperor" / "Third Young Master Xiao" were three unrelated people across three dimensions | Every dimension is a zod schema + `response_format: json_object`; if the model drifts (bare array, code fence, single object) it's fault-tolerant-normalized then validated, missing required fields explicitly report `schema_invalid`; cross-dimension entity merge (normalize same-name / alias-set intersection / appellation-suffix containment) produces an aligned entity table |
| 5 | Concurrency hardcoded at 8, failures silently swallowed by `catch{}` — the user saw a screen of ❌ but didn't know if it was rate-limit, window-overflow, or content-filter | Concurrency configurable (`--map-workers`); exponential backoff + jitter retry, 429 honors `Retry-After`; all failures classified as `rate_limit / server_error / context_overflow / content_filter / auth / network / schema_invalid / parse_error` and surfaced with actionable advice, never swallowed |

---

## Who should use it

- **Web-novel / short-video script writers** who want a book's skeleton (hook formula, payoff points, character cards, foreshadowing, pacing) ready to feed a writing AI.
- **Note-takers and researchers** who want queryable, structured extraction rather than a flat summary.
- **Teachers dissecting textbooks** who want a knowledge tree, concept-dependency graph, and strict definitions.
- **Anyone building a writing AI pipeline** who needs a system prompt + lorebook generated from a source book.

## Who should NOT use it

- You want a **plain summary** — this is structured, reusable output, not a recap.
- You have **no OpenAI-compatible API key** — the dissection step needs an LLM (probe and dry-run are free).
- You want a **web UI** — this is CLI-first by design (see Design tradeoffs).
- You have a **scanned-image PDF** — no built-in OCR (see Current limits).

---

## Support matrix

| Format \ Template | webnovel | tradebook | textbook | paper | screenplay | @custom | Notes |
|---|---|---|---|---|---|---|---|
| `.txt` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Auto encoding detection (GBK/GB18030/BIG5/Shift_JIS/EUC-KR); no own toc, relies on six-strategy chapter split |
| `.md` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Hash headings used directly as toc; chapter confidence usually highest, **recommended to convert to md first** |
| `.epub` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Reads only the spine's linear body (skips cover/copyright/notes); NCX / nav.xhtml toc drives chapter split first |
| `.docx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Heading1/2/3 and "标题 1" style extracted as toc |
| `.pdf` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Text-layer PDF only; scanned copies need OCR first (see Current limits) |
| `.srt` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Strips indices and timecodes, pure dialogue stream fed to screenplay template |

Template coverage:

- **webnovel** — hook formula, hooks, paywall checkpoints, golden finger, character cards, foreshadowing, pacing curve — for creation and imitation
- **tradebook** — core argument, argument structure, cases, key concepts, actionable checklist — for "usable after reading"
- **textbook** — knowledge tree, concept-dependency graph, strict definitions, exercise points — for learning and lesson prep
- **paper** — research question, method, experiment design, result data, innovation, improveable points — for literature reading and reproduction
- **screenplay** — scenes, beats, character arcs, dialogue style, act structure — for film/short-drama creation
- **@custom** — `--template "@custom:./my.json"` uses your own dimension definition; JSON format in `src/templates/custom.ts` header comment

---

## Quick start

```bash
# 1. Install (Node >= 22)
git clone https://github.com/huanweide/book-dissector.git book-dissector
cd book-dissector
npm install
npm run build        # produces dist/

# 2. Configure key (placeholder only; .env is gitignored, never committed)
cp .env.example .env
# edit .env: choose provider (openai/siliconflow/deepseek/groq/custom), fill your own key

# 3. Three commands
# a) probe: only detects format, encoding, chapter split — no LLM call, costs nothing
node dist/cli.js probe your-book.epub

# b) analyze --dry-run: prints the call plan and estimated tokens — still no cost
node dist/cli.js analyze your-book.epub --dry-run

# c) real dissection: get all five exports at once
node dist/cli.js analyze your-book.epub -t webnovel -d standard -f md,json,lorebook,cards,prompt -o out
```

Environment variables (CLI args override, highest priority):

| Variable | Description |
|---|---|
| `BOOK_DISSECTOR_PROVIDER` | `openai` / `siliconflow` / `deepseek` / `groq` / `custom` |
| `BOOK_DISSECTOR_API_KEY` | API Key (or provider-specific vars like `DEEPSEEK_API_KEY`) |
| `BOOK_DISSECTOR_BASE_URL` | custom OpenAI-compatible endpoint (required for `provider=custom`, must include `/v1`) |
| `BOOK_DISSECTOR_MODEL` | default model, overridable by `--model` |

---

## CLI parameters

### `analyze <file>` — dissect a book and export

| Param | Default | Description |
|---|---|---|
| `-t, --template <id>` | `webnovel` | Template: one of five built-ins, or `@custom:./x.json` |
| `-d, --depth <depth>` | `standard` | `quick` (equidistant 3-block sample + local merge, cheapest) / `standard` / `deep` (one extra cross-dimension consistency check) |
| `-m, --model <model>` | provider default | Model name, decides token budget |
| `-p, --provider <provider>` | `deepseek` | Provider, see table above |
| `--api-key <key>` | env var | API Key |
| `--base-url <url>` | provider default | custom OpenAI-compatible baseURL |
| `-f, --format <formats>` | `md,json` | comma-separated: `md` / `json` / `lorebook` / `cards` / `prompt` (multi-select; `entities.json` always produced) |
| `-o, --out <dir>` | `out` | output directory |
| `--token-budget <n>` | auto by model | per-chunk token budget; lower manually when over-window |
| `--map-workers <n>` | `4` | map-stage concurrency; lower if 429s are frequent |
| `--max-chunks <n>` | all | max chunks to process (debug) |
| `--dry-run` | off | only parse + split + print plan, no LLM call |
| `--separator <sep>` | none | manually specify chapter separator, highest priority over all auto strategies |
| `--separator-regex` | off | treat `--separator` as regex |
| `--min-chapters <n>` | `3` | fewer than this is treated as "not recognized" |
| `--chunk-chars <n>` | `4000` | target chars per chapter in fallback even split |

### `probe <file>` — free reconnaissance

Prints format, encoding detection result and confidence, char/token estimate, toc hit status, chapter-split strategy and confidence, first 12 chapter titles, and chunk estimate under the default budget. Shares `--separator` / `--separator-regex` / `--min-chapters` / `--chunk-chars`.

### `templates` — list built-in templates

`--json` outputs JSON, directly adaptable into a custom template.

---

## Output formats

`analyze` produces the formats you request in the output directory, plus the **always-produced** `entities.json` (the cross-dimension aligned entity table is this project's core increment over the prototype).

| File | What it is | Use it for |
|---|---|---|
| `dissect.md` | Human-readable report: meta, chapter split (with confidence and warnings), entity table, per-dimension items (with source evidence), failure log | Quick-review dissection quality; spot-check before trusting when confidence is low |
| `dissect.json` | Full structured result (`DissectResult`): meta / chapters / chapterDetect / dimensions / entities / failures | Programmatic: query, filter, reprocess, feed your own pipeline |
| `lorebook.json` | SillyTavern world-info format: one entry per entity (aliases in key, position by type) + one entry per dimension | Drop straight into SillyTavern / any writing frontend so the AI remembers the book's settings and characters |
| `cards.json` | Card array: entity cards + dimension-item cards, each with markdown body and structured fields | One card pasted into any writing tool; `fields` for programmatic use |
| `system-prompt.txt` | **A system prompt you can copy-paste directly** (core selling point, see below) | Paste into any writing AI's system prompt to load the book's skeleton into its "brain" |
| `entities.json` | Merged entity table: id / canonical / aliases / type / descriptions / mentionCount / sourceChunkIds | Entity alignment, injection, or counting "who's really the protagonist" |

### Spotlight: what `system-prompt.txt` is

After dissecting a book, what users really want is usually not a report but "load the book's skeleton into any writing AI's brain". This file does exactly that:

- **Character cards first** — merged characters (with all aliases) ranked highest priority, with a one-line description, to prevent OOC
- **Dimension highlights** — sorted by writing impact (worldview → characters → power system → hook formula → pacing → paywall checkpoint → plot …), each with key fields
- **Iron-rule section** — only use listed settings, characters don't break OOC, no spoilers, don't invent without evidence, keep original pacing
- **Confidence statement** — the file footer comment states this run's chapter-split strategy, confidence, model, and whether any dimension failed — **read this before use; don't fully trust a low-confidence dissection**

---

## Design tradeoffs

**Why CLI-first, no web.** Dissection is heavy: a standard-depth book takes dozens of LLM calls over minutes to tens of minutes; the user's posture is "batch-run in background + go do something else". A web UI adds nothing but a heartbeat connection and progress polling. More importantly, effort allocation: this project's winning move is "dissect accurately" (encoding, chapter split, schema, entity alignment), each a dirty job; a web UI would burn effort on login state, task queues, and frontend. CLI output is files, naturally scriptable, CI-friendly, and consumable by other tools.

**Why map-reduce, not one long prompt.** Three reasons: ① window overflow — reverse-derive budget from the model's context window, Chinese ~1.05 tokens/char deliberately overestimated, rather over-split; ② information loss — 60k–80k chars in one prompt collapses extraction quality for the middle-to-late sections; ③ cost — map covers all dimensions in one call (full text scanned once), reduce feeds only candidate items not source, merge cost decoupled from book length. The `quick` tier even only equidistant-samples 3 blocks + local merge, making "spend the least first, see the gist" a default option.

**Why every dimension needs a schema.** Free Markdown strings have three fatal flaws: unqueryable ("sort all face-slapping hooks by chapter" is impossible), unvalidatable (you can't tell if the model dropped a field), and no cross-dimension entity alignment ("Xiao Yan" and "Flame Emperor" stay two people forever). zod schema + json mode solves all three at once; fields are kept deliberately flat + few because JSON mode in small/mid models starts hallucinating once nesting deepens — flat `items[]` is the most stable shape across providers.

---

## Current limits

Honest list, so you don't find out after the fact:

1. **Scanned-image PDFs don't work.** Only text-layer PDFs parse. Scanned/image PDFs error explicitly and suggest OCR-to-txt first — this project has no built-in OCR.
2. **Million-character epics: run in chunks.** Map-call count grows linearly with length (24k tokens/chunk); 3M chars ≈ 150+ calls, budget time and money upfront; use `--max-chunks` to try-read first, or split the book into multiple files.
3. **Non-standard self-published / doujinshi may fail chapter recognition.** It then returns `confidence:'none'` and warns (this is a feature, not a bug) — use `--separator` to specify manually, e.g. `--separator '第' --separator-regex` with regex `'^\\[场景'` for scripts.
4. **No cloud account system, no web version.** Bring your own OpenAI-compatible API key (DeepSeek / SiliconFlow / Groq / OpenAI or self-hosted endpoint); the key only goes into `.env` or CLI args, no credentials in code.
5. **Encoding detection isn't 100%.** Confidence <0.6 warns, but extreme niche encodings may still garble; if garbled, convert to UTF-8 txt/md first.
6. **`quick` tier doesn't call LLM reduce.** Its role is cheapest-gist; items aren't deduped or merged — don't treat its output as the final result.
7. **epub/docx depend on the file's own structure being clean.** Regex strips tags rather than full XML parsing; heavily malformed packaging may fail — convert to txt/md first.

---

## Roadmap

- [ ] mobi / azw3 input (via calibre conversion chain or pure-JS unpack)
- [ ] OCR preprocessing pipeline for scanned PDFs (optional)
- [ ] lorebook incremental merge: combine multiple dissections of one book into one world book
- [ ] Interactive chapter confirmation (TUI): confirm boundaries chapter-by-chapter at low confidence before continuing
- [ ] embedding-based coarse dedup to lower reduce-stage token cost
- [ ] More provider json-mode compatibility test matrix
- [ ] Windows one-click script (probe + analyze wrapper)

---

## Development

```bash
npm run build      # tsc produces dist/
npm run typecheck  # tsc --noEmit
npm run fixtures   # regenerate tests/fixtures (GBK txt / minimal epub / minimal docx / srt / per-strategy corpora)
npm test           # vitest run (68 cases)
```

Test coverage: encoding detection (GBK no garble), epub/docx/srt/md parsing, one example per six chapter-split strategies, no-chapter-number iron-case (must `confidence:'none'` + warn), token-budget boundary (exactly at limit / one char over), entity merge (Xiao Yan/Flame Emperor/Third Young Master Xiao → same id), 429 exponential backoff retry, probe zero LLM calls, five-output rendering, template schema validation. Project structure in `src/` directory header comments.

## License

MIT.
