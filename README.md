# book-dissector

**把一本书拆成能直接拿去用的零件。**

[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![文档: 中文](https://img.shields.io/badge/%E6%96%87%E6%A1%A3-%E4%B8%AD%E6%96%87-red)](#book-dissector)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-64%20passed-brightgreen)](#开发)

一个通用书籍结构化拆解 CLI：读入 txt / md / epub / docx / pdf / srt，按 token 预算做 map-reduce 抽取，导出 md 报告、json 全量、SillyTavern lorebook、角色设定卡，以及**一段可直接喂给写作 AI 的系统提示词**。

从 novel-forge 的拆书模块独立出来做的特化，目标用户：写网文的、写短视频脚本的、做读书笔记的、带娃拆教材的老师。卖点不是「总结得更好」，是**输出能拿去再用**。

---

## 它和别的 AI 拆书工具有什么不一样

这张表是本项目存在的理由。左列是原型（novel-forge 拆书模块）真实踩过的坑，右列是本作的修法：

| # | 原型的坑 | 本作的修法 |
|---|---------|-----------|
| 1 | 只支持 txt/md；GBK/GB18030 存档的中文网文一读就乱码，乱码文本直接喂给 LLM，后面所有维度静默全错，用户看不出来 | 六种格式 + 三级编码检测（BOM → UTF-8 严格解码 → 多候选常用字统计打分）。GBK 语料常用字占比 0.6+，乱码 0.1 左右，判别可靠；置信度 < 0.6 时 CLI 直接告警「可能仍会乱码」 |
| 2 | 分章正则只认「第X章 / Chapter N」，命中 < 3 就按 4000 字硬切，UI 还静默显示「已识别 N 章」——用户根本不知道分章是假的。英文书 / 教材 / 论文 / 剧本 / 无章节号的现代小说全部退化 | 六种策略并行召回（目录 / Markdown 标题 / 中文第X章 / 英文 Chapter / 数字大纲 / 独占短行）→ 按命中数、间距规律性、标题形态、覆盖率打分选优 → 置信度分 high/medium/low/none 四级。**认不出时返回 `confidence:'none'` + 警告横幅，绝不返回假章节还假装成功**；`--separator` 允许手动指定分隔符兜底 |
| 3 | 单次 prompt 硬塞 6~8 万字，换个模型就超窗；deep 模式 15 个维度各发一遍全文，钱烧在重复传输上 | 按模型 context window 反推 token 预算（精确表 + 前缀兜底 + provider 保守值，夹到 [1200, 24000]），map-reduce：map 阶段一次调用覆盖全部维度（全文只过一遍），reduce 阶段只喂候选条目不喂原文（成本与原书长度解耦）；超窗的 chunk 进串行补偿队列自动对半再切 |
| 4 | 输出是自由 Markdown 字符串：不能查询、不能校验、没法做跨维度实体对齐——「萧炎」「炎帝」「萧家三少」在三个维度里是三个互不相干的人 | 每个维度都是 zod schema + `response_format: json_object`，模型跑偏（裸数组、代码围栏、单对象）先容错归一化再校验，必填字段缺失显式报 `schema_invalid`；跨维度实体归并（归一化同名 / 别名集合相交 / 称谓后缀包含）产出对齐的实体表 |
| 5 | 并发硬编码 8，失败被 `catch{}` 静默吞掉，用户看到满屏 ❌ 却不知道是限流、超窗还是内容过滤 | 并发可配置（`--map-workers`）；指数退避 + 抖动重试，429 听从 `Retry-After`；所有失败按 `rate_limit / server_error / context_overflow / content_filter / auth / network / schema_invalid / parse_error` 分类透出，带可操作建议，绝不被吞 |

---

## 支持矩阵

| 格式 \ 模板 | webnovel | tradebook | textbook | paper | screenplay | @custom | 解析要点 |
|---|---|---|---|---|---|---|---|
| `.txt` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 自动编码检测（GBK/GB18030/BIG5/Shift_JIS/EUC-KR），无自带目录，靠六策略分章 |
| `.md` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 井号标题直接当 toc 用，分章置信度通常最高，**推荐优先转成 md** |
| `.epub` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 只读 spine 的 linear 正文（跳过封面/版权/注释）；NCX / nav.xhtml 目录优先驱动分章 |
| `.docx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Heading1/2/3 与「标题 1」样式提取为 toc |
| `.pdf` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 仅文字层 PDF；扫描件需先 OCR（见「当前不能做什么」） |
| `.srt` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 剥掉序号与时间轴，纯对白流交给 screenplay 模板 |

模板覆盖：

- **webnovel（网文/小说）**：爽点公式、钩子、付费卡点、金手指、角色卡、伏笔、节奏曲线——面向创作与仿写
- **tradebook（商业/社科）**：核心论点、论证结构、案例、关键概念、可执行清单——面向「读完就能用」
- **textbook（教材/技术书）**：知识树、概念依赖图、严格定义、习题要点——面向学习与备课
- **paper（论文）**：研究问题、方法、实验设计、结果数据、创新点、可改进处——面向文献阅读与复现
- **screenplay（剧本/影视）**：场次、节拍、人物弧光、对白风格、幕结构——面向影视与短剧创作
- **@custom**：`--template "@custom:./my.json"` 用自己的维度定义，JSON 格式见 `src/templates/custom.ts` 头部注释

---

## 快速开始

```bash
# 1. 安装（Node >= 22）
git clone <你的仓库地址> book-dissector
cd book-dissector
npm install
npm run build        # 产出 dist/

# 2. 配置 key（只写占位符，.env 已被 .gitignore 排除，绝不入库）
cp .env.example .env
# 编辑 .env：选 provider（openai/siliconflow/deepseek/groq/custom），填入你自己的 key

# 3. 三条命令
# a) probe：只探格式、编码、分章，不调用 LLM，一分钱不花
node dist/cli.js probe 你的书.epub

# b) analyze --dry-run：连调用计划与预计 token 都打印出来，还是不花钱
node dist/cli.js analyze 你的书.epub --dry-run

# c) 正式拆解：一次拿到五种导出物
node dist/cli.js analyze 你的书.epub -t webnovel -d standard -f md,json,lorebook,cards,prompt -o out
```

环境变量（也可用命令行参数覆盖，命令行优先级最高）：

| 变量 | 说明 |
|---|---|
| `BOOK_DISSECTOR_PROVIDER` | `openai` / `siliconflow` / `deepseek` / `groq` / `custom` |
| `BOOK_DISSECTOR_API_KEY` | API Key（也可用各 provider 专属变量如 `DEEPSEEK_API_KEY`） |
| `BOOK_DISSECTOR_BASE_URL` | 自定义 OpenAI 兼容端点（`provider=custom` 时必填，需含 `/v1`） |
| `BOOK_DISSECTOR_MODEL` | 默认模型，可被 `--model` 覆盖 |

---

## CLI 全参数表

### `analyze <file>` —— 拆解一本书并导出

| 参数 | 默认 | 说明 |
|---|---|---|
| `-t, --template <id>` | `webnovel` | 模板：五套内置之一，或 `@custom:./x.json` |
| `-d, --depth <depth>` | `standard` | `quick`（等距采样 3 块 + 本地归并，最便宜）/ `standard` / `deep`（多一次跨维度一致性校验） |
| `-m, --model <model>` | provider 默认 | 模型名，决定 token 预算 |
| `-p, --provider <provider>` | `deepseek` | provider，见上表 |
| `--api-key <key>` | 环境变量 | API Key |
| `--base-url <url>` | provider 默认 | 自定义 OpenAI 兼容 baseURL |
| `-f, --format <formats>` | `md,json` | 逗号分隔：`md` / `json` / `lorebook` / `cards` / `prompt`（可多选，`entities.json` 始终产出） |
| `-o, --out <dir>` | `out` | 输出目录 |
| `--token-budget <n>` | 按模型自动 | 单 chunk 的 token 预算，超窗时手动调小 |
| `--map-workers <n>` | `4` | map 阶段并发数，429 频繁就调小 |
| `--max-chunks <n>` | 全部 | 最多处理多少个 chunk（调试用） |
| `--dry-run` | 关 | 只解析 + 分章 + 打印计划，不调用 LLM |
| `--separator <sep>` | 无 | 手动指定章节分隔符，优先级高于一切自动策略 |
| `--separator-regex` | 关 | 把 `--separator` 当正则处理 |
| `--min-chapters <n>` | `3` | 少于该章节数视为「未识别」 |
| `--chunk-chars <n>` | `4000` | 兜底均匀切分时每章目标字数 |

### `probe <file>` —— 不花钱的侦察

打印格式、编码检测结果与置信度、字数/token 估算、toc 命中情况、分章策略与置信度、前 12 章标题、按默认预算的切块预估。共享 `--separator` / `--separator-regex` / `--min-chapters` / `--chunk-chars`。

### `templates` —— 列出内置模板

`--json` 以 JSON 输出，可直接拿去改造成自定义模板。

---

## 输出格式说明

`analyze` 会在输出目录产出你请求的格式，外加**始终产出**的 `entities.json`（跨维度对齐的实体表是本项目相对原型的核心增量）。

| 文件 | 是什么 | 拿去干嘛 |
|---|---|---|
| `dissect.md` | 人读的报告：元信息、分章情况（含置信度与警告）、实体表、各维度条目（含原文依据 evidence）、失败记录 | 快速 review 拆解质量；置信度低时先抽查再信任 |
| `dissect.json` | 全量结构化结果（`DissectResult`）：meta / chapters / chapterDetect / dimensions / entities / failures | 程序消费：查询、筛选、二次加工、喂给自己的 pipeline |
| `lorebook.json` | SillyTavern world info 格式：实体一条 entry（别名进 key，按类型定 position）+ 每个维度一条 entry | 直接丢进 SillyTavern / 各类写作前端，让 AI 记住这本书的设定与角色 |
| `cards.json` | 卡片数组：实体卡 + 维度条目卡，每张含 markdown 正文与结构化 fields | 一张卡直接贴进任何写作工具；`fields` 供程序取用 |
| `system-prompt.txt` | **一段可直接复制粘贴的系统提示词**（核心卖点，见下） | 塞进任意写作 AI 的 system prompt，把这本书的骨架装进它的脑子 |
| `entities.json` | 归并后的实体表：id / canonical / aliases / type / descriptions / mentionCount / sourceChunkIds | 做实体对齐、注入、或统计「谁才是真主角」 |

### 重点：`system-prompt.txt` 是什么

拆完一本书，用户真正想要的通常不是一份报告，而是「把这本书的骨架塞进任意写作 AI 的脑子里」。这份文件就是干这个的：

- **人物卡优先**：归并后的角色（含全部别名）排在最高优先级，附一句话描述，防 OOC
- **维度要点**：按对写作影响的大小排序（世界观 → 人物 → 力量体系 → 爽点公式 → 节奏 → 付费卡点 → 情节……），每条带关键字段
- **铁律段**：只使用列出的设定、人物不 OOC、不剧透、没依据别编、保持原作节奏
- **可信度声明**：文件尾部的注释里写明本次拆解的分章策略、置信度、模型，以及是否有失败维度——**用之前先看这段，低置信度的拆解不要全信**

---

## 设计取舍

**为什么 CLI 优先、不做网页。** 拆书是重活：一本书标准深度要几十次 LLM 调用、几分钟到几十分钟，用户的使用姿势是「挂机批处理 + 去看别的」，网页除了让这个过程多一层心跳连接和进度轮询没有任何增益。更重要的是精力分配：本项目的胜负手是「拆得准」（编码、分章、schema、实体对齐），每一个都是脏活，做成网页会把精力耗在登录态、任务队列和前端上。CLI 的输出是文件，天然适合脚本化、进 CI、被别的工具消费。

**为什么用 map-reduce 而不是单次长 prompt。** 三个理由：① 超窗——按模型 context window 反推预算，中文 1 字≈1.05 token 刻意高估，宁可多切一刀；② 信息损失——6~8 万字塞进一个 prompt，模型对中后段的提取质量断崖式下跌；③ 成本——map 一次调用覆盖全部维度（全文只过一遍），reduce 只喂候选条目不喂原文，归并成本与原书长度解耦。quick 档甚至只等距采样 3 块 + 本地归并，把「先花最少的钱看个大概」做成默认选项之一。

**为什么每个维度都要 schema。** 自由 Markdown 字符串有三个死穴：不能查询（「把所有打脸型爽点按章节排序」做不到）、不能校验（模型少写一个字段你看不出来）、不能做跨维度实体对齐（「萧炎」和「炎帝」永远是两个人）。zod schema + json mode 把这三个问题一次性解决；字段刻意保持扁平 + 少量，是因为 JSON mode 在中小模型上嵌套一深就开始瞎编，扁平的 `items[]` 是跨 provider 最稳的形态。

---

## 当前不能做什么

诚实清单，避免你踩了才说：

1. **PDF 扫描件不行。** 只解析文字层 PDF。扫描版/图片 PDF 会明确报错并提示先 OCR 转 txt——本项目不内置 OCR。
2. **百万字巨著建议分段跑。** map 调用次数随字数线性增长（24k token/块），三百万字约 150+ 次调用，费用和时间都要提前算；可以用 `--max-chunks` 先试读，或把书按部头拆成多个文件分别跑。
3. **不规范的自印书 / 同人志可能认不出章节。** 此时会返回 `confidence:'none'` 并报警（这是特性不是 bug），请用 `--separator` 手动指定分隔符，例如 `--separator '第' --separator-regex` 配合正则 `'^\\[场景'` 拆剧本。
4. **没有云端账号体系，也没有网页版。** 需要自备任一 OpenAI 兼容 API key（DeepSeek / SiliconFlow / Groq / OpenAI 或自建端点），Key 只进 `.env` 或命令行参数，代码里没有任何凭据。
5. **编码检测不是 100%。** 置信度 < 0.6 时会告警，但极端小众编码仍可能乱码；遇到乱码请先转成 UTF-8 的 txt/md。
6. **`quick` 档不调 LLM reduce。** 它的定位就是最便宜看大概，条目不去重不归并，别把它的输出当最终结果。
7. **epub/docx 依赖文件自身结构规整。** 用正则剥标签而非完整 XML 解析，遇到重度畸形封装可能失败，届时请先转 txt/md。

---

## Roadmap

- [ ] mobi / azw3 输入（经 calibre 转换链或纯 JS 解包）
- [ ] PDF 扫描件的 OCR 预处理管道（可选接入）
- [ ] lorebook 增量合并：同一本书多次拆解后合成一个世界书
- [ ] 交互式分章确认（TUI）：低置信度时逐章让人确认边界再继续
- [ ] embedding 粗去重，降低 reduce 阶段的 token 消耗
- [ ] 更多 provider 的 json mode 兼容性实测矩阵
- [ ] Windows 一键脚本（probe + analyze 封装）

---

## 开发

```bash
npm run build      # tsc 产出 dist/
npm run typecheck  # tsc --noEmit
npm run fixtures   # 重新生成 tests/fixtures（GBK txt / 极简 epub / 极简 docx / srt / 各策略语料）
npm test           # vitest run（64 个用例）
```

测试覆盖：编码检测（GBK 不乱码）、epub/docx/srt/md 解析、六种分章策略各一例、无章节号铁律用例（必须 `confidence:'none'` 并报警）、token 预算边界（刚好等于上限 / 超出一个字）、实体归并（萧炎/炎帝/萧家三少 → 同一 id）、429 指数退避重试、probe 零 LLM 调用、五种输出物渲染、模板 schema 校验。项目结构见 `src/` 各目录头部注释。
