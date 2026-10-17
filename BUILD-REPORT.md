# BUILD-REPORT — book-dissector v0.1.0

日期：2026-10-17 ｜ 范围：补齐 README / 测试 / fixtures，跑通 tsc + vitest 门禁，修 bug

## 1. 门禁结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 错** |
| 构建 | `npm run build` | 成功，`dist/`（含 `dist/cli.js`）正常产出 |
| 测试 | `npx vitest run` | **9 个文件 / 64 个用例全部通过** |
| CLI 冒烟 | `node dist/cli.js probe` / `analyze --dry-run` / `templates` | 正常；GBK 文件正确解码；无章节文本触发警告横幅；dry-run 零 LLM 调用 |

## 2. 修掉的 bug（共 11 个）

### 编译错误（9 个，tsc 门禁）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| 1 | `src/chunk/chapter-detector.ts:90` | 局部变量 `tocHeadings` 与同名函数形成遮蔽，TS7022 自引用 + TS2448 先用后声明 | 改名 `tocHs`，注释说明原因 |
| 2 | `src/cli.ts:310-311` | `DetectOptions` / `TocEntry` 未导入，TS2304 ×2 | 补 `import type`（从 types 与 chapter-detector） |
| 3 | `src/extract/pipeline.ts:65` | 解构出 `client` / `bookTitle` 但函数体内未直接用，TS6133 ×2 | 只解构 `template` / `depth`（其余经 `opts` 访问），注释说明 |
| 4 | `src/formats/pdf.ts:14` | 参数属性 `readonly cause` 重写 Error 基类成员，TS4115 | 改走标准通道 `super(message, { cause })` |
| 5 | `src/output/cards.ts:8` | `MergedEntity` 导入未使用，TS6196 | 删除该导入 |
| 6 | `src/templates/index.ts:6` | `parseCustomTemplate` 导入未使用（本文件只做 re-export），TS6133 | 从 import 中移除 |

### 运行时 / 逻辑 bug（通读 + 测试发现，5 个）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| 7 | `src/chunk/chapter-detector.ts`（matchTitle + NUMERIC_OUTLINE_RE） | 数字大纲正则是**非捕获组**，而 matchTitle 读 `m[1]` → 命中「1. 引言」这类行直接抛 TypeError，整个分章崩溃 | 编号改为捕获组；matchTitle 对 `m[1]` 缺失做容错 |
| 8 | `src/chunk/chapter-detector.ts`（EN_CHAPTER_RE） | 「Chapter N」的编号被拆到第二组，标题拼装时丢失（"Chapter 5 沙漠" → "Chapter 沙漠"） | 把「keyword + 编号」整体作为第一组捕获 |
| 9 | `src/chunk/chapter-detector.ts`（shortLineHeadings） | 要求「下一行非空」，但真实书籍排版是「标题 → 空行 → 正文」，**该策略对最常见形态永远 0 命中**，名存实亡（且与注释意图相反） | 移除「下一行非空」条件，「独占一行」由上一行空白/完整收束保证 |
| 10 | `src/templates/base.ts`（buildDimensionSchema） | required 字段用 `z.unknown()`，而 `z.unknown()` 连 undefined 都放过——「必填」名存实亡，模型漏写 name/detail 时不报错，缺字段卡片一路流到输出层 | required 字段加 `.refine(v => v !== undefined)` |
| 11 | `src/templates/base.ts`（extractJson） | 扫描括号栈后两个分支都返回整个 candidate，模型在 JSON 后追加的解释文字会导致 `JSON.parse` 失败——map 阶段白白多花一次修复调用，reduce 阶段误报 schema_invalid | 找到平衡闭合处即截断（`end > 0 ? slice(0, end) : candidate`），保持原容错语义 |

修复均未改变既有设计意图；每处改动都在注释里写了「为什么」。

## 3. 新增文件

### `scripts/gen-fixtures.mjs`（npm run fixtures）

用 jszip 现场打包 + iconv-lite 编码，生成 10 个 fixtures 到 `tests/fixtures/`：

- `sample.epub`：container.xml + OPF（spine/manifest）+ NCX 目录 + 3 个 xhtml（标题在正文内，可回填 offset）
- `sample.docx`：word/document.xml（Heading1/2 样式段落）+ docProps/core.xml
- `gbk.txt`：GBK 编码中文小说（编码检测用例）
- `plain-continuous.txt`：无章节号连续文本（铁律用例）
- `novel-cn.txt` / `novel-en.txt` / `outline.md` / `outline-numeric.txt` / `shortline.txt`：五个分章策略专用语料
- `sample.srt`：含序号与时间轴的字幕

### `tests/`（9 个文件 / 64 用例）

| 文件 | 覆盖 |
|---|---|
| `encoding.test.ts`（5） | GBK 读出来不乱码（断言含中文、无 U+FFFD、编码命中 gb18030 系）、UTF-8 BOM、UTF-8 严格快路径、纯 ASCII 快路径、normalizeText |
| `formats.test.ts`（6） | epub 正文+元信息+NCX 目录（含 offset 回填）、docx 正文+标题样式 toc、srt 剥序号/时间轴、md 标题目录、扩展名分发与报错、PDF 抛 PdfUnsupportedError |
| `chapter.test.ts`（10） | **六种分章策略各一例**（中文第X章 / 英文 Chapter N 且断言标题保留编号 / Markdown 井号 / 数字行 / 短行 / epub toc 驱动）+ md toc 驱动；**铁律用例**：无章节号 → `confidence==='none'` + strategy `fixed-length` + 警告含 separator 建议 + 兜底标题自认「非真实章节」；手动分隔符优先级；正则分隔符不足阈值降 medium 并告警 |
| `token.test.ts`（7） | estimateTokens 中/英/空；**token 预算边界：刚好等于上限 → 单块；超出一个字 → 必须切开且每块不超限、拼接无损**；buildChunks 小章合并（chapterIndexes 溯源）/ 单章超预算再切；sampleChunks 等距采样含首尾 |
| `entity-merge.test.ts`（4） | **萧炎/炎帝/萧家三少 → 同一 id**（canonical=萧炎、aliases 含两者、mentionCount=3、别名不再单独成实体、药老不受影响）；normalizeName 归一化；称谓后缀合并与单字防误并；空输入过滤 |
| `llm-retry.test.ts`（7） | **mock fetch 前两次返 429、第三次成功 → 断言共 3 次调用且最终成功**（注入 sleep 不真睡，onRetry 两次 rate_limit）；401 不可重试只调 1 次；持续 500 重试到上限抛 server_error；网络错误归类；classifyHttp 全覆盖；withRetry 退避曲线（1000+jitter / 2000+jitter） |
| `probe-no-llm.test.ts`（2） | **probeFile + detectChapters 全流程 mock fetch 断言调用次数为 0**（txt 与 epub 各一例） |
| `output.test.ts`（9） | md 报告（含低置信度必须渲染警告块）、json round-trip、lorebook 结构（别名进 key / position 映射）、cards、**system-prompt 核心卖点断言**（人物卡/维度要点/铁律/可信度声明）、parseFormats 校验去重报错、五种格式渲染、writeOutputs 落盘 |
| `template-schema.test.ts`（14） | schema 合法通过 / **缺必填字段报 schema_invalid**（回归 bug #10）/ confidence 越界拒绝 / 裸数组与围栏容错；**extractJson 截断尾随文字（回归 bug #11）**；内置五模板齐全与 key 规范；@custom 加载与三类报错；contextWindow 三级回退；defaultTokenBudget 夹取 |

`tests/helpers.ts` 提供 fixtures 路径与缺失时自动生成，保证 `npx vitest run` 独立可用。

### `README.md`（中文，九节）

1. 标题 + 一句话定位 + 六枚 shields.io 徽章（Node ≥22 / TypeScript / MIT / 中文说明 / 平台 / 测试）
2. 「它和别的 AI 拆书工具有什么不一样」——**五行对照表，每行对应一个原型真实坑**（编码乱码 / 分章假装成功 / 单 prompt 硬塞 / 输出无 schema / 静默吞错），右列写具体修法
3. 支持矩阵：6 格式 × 6 模板 + 每格式解析要点
4. 快速开始：安装、环境变量（仅占位符）、三条命令（含 probe 与 --dry-run 两个不花钱的）
5. CLI 全参数表：analyze 15 个选项 + probe + templates
6. 输出格式说明：五种导出物 + 始终产出的 entities.json，**重点讲 system-prompt.txt（核心卖点）**
7. 设计取舍：CLI 优先不做网页 / map-reduce / 每维度 schema
8. 「当前不能做什么」：7 条诚实清单（PDF 扫描件、百万字分段、认不出章节、无云端账号、编码非 100%、quick 不归并、畸形封装）
9. Roadmap + 开发命令

## 4. 收项检查

- `.gitignore`：已排除 `node_modules/`、`dist/`、`.env`（含 `.env.*` 且 `!.env.example`）、`out/`（另含 `output/`、`coverage/`、`*.dissect.json`）✅
- `.env.example`：只有占位符（`sk-your-key-here` 与空值），**无任何真实凭据**；源码中亦无硬编码 key ✅
- **未执行 git init / commit / push**（按需求留给统一处理）✅
- 无散落临时文件（调试脚本已清理）✅

## 5. 没做到 / 遗留

1. **map-reduce 流水线无端到端测试**：`runPipeline` 依赖 LLM 响应，未注入 fake client 做全流程 mock；只覆盖到 `LLMClient.chat` 层的重试行为。补它需要一个 fake client 抽象，属于测试基建而非 bug 修复，未擅自动 src。
2. **PDF 只测了错误路径**：pdf-parse 已安装，测试喂非 PDF 缓冲区验证抛 `PdfUnsupportedError`；未构造真实文字层 PDF（需要额外生成成本，且 pdf-parse 对极简 PDF 支持不稳）。
3. **Windows 一键脚本**未做（已列入 README Roadmap）。
4. **mobi/azw3 不支持**（README「当前不能做什么」已声明）。
