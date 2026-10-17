// ============================================================
// 测试 fixtures 生成器（npm run fixtures）
// ------------------------------------------------------------
// 全部现场生成，不把二进制/大文本塞进 git：
//   · 极简 epub（jszip）：META-INF/container.xml + OPF(spine/manifest) + NCX + 3 个 xhtml
//   · 极简 docx（jszip）：word/document.xml（含 Heading1/2 样式）+ docProps/core.xml
//   · GBK 编码 txt（iconv-lite 编码，验证编码检测不乱码）
//   · 无章节号的连续文本（分章铁律用例：必须 confidence='none'）
//   · srt 字幕
//   · 五个分章策略各自的专用语料（中文第X章 / Chapter N / md 井号 / 数字行 / 短行）
// ============================================================

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import iconv from "iconv-lite";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(here, "..", "tests", "fixtures");
await mkdir(FIXTURES_DIR, { recursive: true });

const written = [];
async function put(name, data) {
  await writeFile(join(FIXTURES_DIR, name), data);
  written.push(name);
}

// ─── 1. GBK 编码的中文小说（编码检测用例） ─────────────────────
const GBK_TEXT = `第一章 沙漠之旅

少年站在沙丘上，望着远方的城池，风沙掩埋了来时的路。他握紧腰间的刀，继续向前走去，心中只有一个念头：活下去。

第二章 古城遗迹

城池的废墟在月光下显得格外寂静。少年推开沉重的石门，灰尘在月光中飞舞，大厅的墙壁上刻着古老的文字。

第三章 神秘老人

一个白发老人从阴影中走出，打量着他。少年警觉地后退半步，手按在刀柄上。老人却笑了，说他已经等了三十年。

第四章 归途

少年带着老人交付的木盒走出城池。沙漠的风依旧在吹，但他知道，回去的路已经和来时不一样了。
`;
await put("gbk.txt", iconv.encode(GBK_TEXT, "gbk"));

// ─── 2. 无章节号的连续文本（分章铁律用例） ─────────────────────
// 每个自然段都是 >30 字、以句号结尾的完整句子行：
// 短行启发式必须全部排除，其余策略也必须 0 命中 → confidence 'none'
const PLAIN_TEXT = `少年站在沙丘上，望着远方的城池，风沙掩埋了来时的路，他握紧腰间的刀继续向前走去，天色渐晚远处传来狼群的嚎叫，他加快脚步心中只有一个念头就是活下去，这片沙漠从来不会怜悯任何人。

城池的废墟在月光下显得格外寂静，少年推开沉重的石门，灰尘在月光中飞舞，大厅的墙壁上刻着古老的文字，记载着一个王朝的兴衰，他伸手触摸那些刻痕，仿佛能听见千百年前的呐喊。

一个白发老人从阴影中走出，上下打量着他，少年警觉地后退半步，手按在刀柄上，随时准备拔刀，老人却笑了，说他已经等了三十年，终于等到一个能读懂这些文字的人，这话让少年愣住了。

少年带着老人交付的木盒走出城池，沙漠的风依旧在吹，但他知道回去的路已经和来时不一样了，远处的商队缓缓走来，驼铃声在热浪中摇晃，新的故事即将开始，而旧的故事已被风沙掩埋。
`;
await put("plain-continuous.txt", PLAIN_TEXT);

// ─── 3. 中文第X章语料（cjk-novel 策略） ───────────────────────
await put("novel-cn.txt", GBK_TEXT);

// ─── 4. 英文 Chapter N 语料（english-chapter 策略） ───────────
const EN_TEXT = `Chapter 1 The Desert

The boy stood on the dune, gazing at the distant city. The wind had buried the road behind him, but he kept walking with his hand on the hilt of his knife. Night fell and the howl of wolves echoed across the sand.

Chapter 2 The Ruins

The ruins of the old city stood silent under the moonlight. He pushed open the heavy stone door and dust danced in the pale light. Ancient words were carved into the walls, telling the rise and fall of a dynasty.

Chapter 3 The Old Man

A white-haired elder stepped out of the shadows and looked him over. The boy stepped back, alert. But the old man smiled and said he had waited thirty years for someone who could read those words.

Chapter 4 The Road Home

The boy walked out of the city with the wooden box the elder had given him. The desert wind still blew, but he knew the road back was no longer the same. A new story was about to begin.
`;
await put("novel-en.txt", EN_TEXT);

// ─── 5. Markdown 井号标题语料（markdown-heading 策略） ─────────
// 6 个标题：让 n>=6 的加分生效，稳定压过同时命中的 cjk-novel
const MD_TEXT = `# 测试文档

这是一个用于验证 Markdown 标题分章的文档，正文第一段。

## 第一章 概述

Markdown 的井号标题是天然目录，解析器会优先把它当作 toc 交给分章引擎，因此置信度通常很高，推荐优先使用。

## 第二章 方法

分章引擎会并行召回多种策略，包括 Markdown 标题、中文网文章节、英文 Chapter、数字大纲与短行启发式，然后按得分选优。

## 第三章 结果

在测试文档上，Markdown 策略命中全部标题，覆盖率与间距规律性都满足高置信度条件，其余策略只命中其中一部分。

## 第四章 讨论

与单正则基线相比，多策略召回在英文书、教材与不规范自印书上的表现更稳，低置信度时会显式告警而不是假装切好。

## 第五章 结论

结论是 Markdown 输入的分章质量最稳定，写作与读书笔记场景建议优先使用。
`;
await put("outline.md", MD_TEXT);

// ─── 6. 数字大纲语料（numeric-outline 策略） ──────────────────
const NUMERIC_TEXT = `1. 引言

本文介绍一种通用的书籍拆解方法，涵盖格式解析、章节识别与结构化抽取三个环节，并说明每一步的设计取舍与适用场景。

2. 相关工作

已有工具大多只支持纯文本，且分章依赖固定正则，遇到英文书或教材就会失效，失败时还静默显示已识别。本章梳理这些不足。

3. 方法

我们提出六种分章策略并行召回，按置信度打分选优，低置信度时显式告警，绝不返回假装切好的假章节，并允许手动指定分隔符。

4. 实验

在六种格式与五类书籍上测试，结果显示自动检测准确率显著高于单正则基线，失败场景均能给出可操作的建议与原因分类。

5. 结论

通用拆解的关键在于结构化输出与透明的置信度，而不是把总结写得更好看，输出物必须能直接拿去再用。
`;
await put("outline-numeric.txt", NUMERIC_TEXT);

// ─── 7. 短行模式语料（short-line 策略） ───────────────────────
const SHORTLINE_TEXT = `沙漠之旅

少年站在沙丘上，望着远方的城池，风沙掩埋了来时的路。他握紧腰间的刀，继续向前走去，心中只有一个念头：活下去。

古城遗迹

城池的废墟在月光下显得格外寂静。少年推开沉重的石门，灰尘在月光中飞舞，大厅的墙壁上刻着古老的文字。

神秘老人

一个白发老人从阴影中走出，打量着他。少年警觉地后退半步，手按在刀柄上，随时准备拔刀出手。

刀光剑影

老人只是笑了笑，抬手之间，一道刀气划破长空，将远处的沙丘劈成两半。少年目瞪口呆，这才明白眼前之人深不可测。

归途

少年带着老人交付的木盒走出城池，沙漠的风依旧在吹，但他知道回去的路已经和来时不一样了。
`;
await put("shortline.txt", SHORTLINE_TEXT);

// ─── 8. srt 字幕 ──────────────────────────────────────────────
const SRT_TEXT = `1
00:00:01,000 --> 00:00:04,000
少年站在沙丘上

2
00:00:04,500 --> 00:00:07,000
望着远方的城池

3
00:00:07,500 --> 00:00:10,000
风沙掩埋了来时的路
`;
await put("sample.srt", SRT_TEXT);

// ─── 9. 极简 epub（jszip 现场打包） ───────────────────────────
const epub = new JSZip();
epub.file("mimetype", "application/epub+zip", { compression: "STORE" });
epub.file(
  "META-INF/container.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
);
epub.file(
  "OEBPS/content.opf",
  `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试之书</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="bookid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="chap3" href="chap3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chap1"/>
    <itemref idref="chap2"/>
    <itemref idref="chap3"/>
  </spine>
</package>`,
);
epub.file(
  "OEBPS/toc.ncx",
  `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:00000000-0000-0000-0000-000000000000"/></head>
  <docTitle><text>测试之书</text></docTitle>
  <navMap>
    <navPoint id="np1" playOrder="1"><navLabel><text>第一章 沙漠之旅</text></navLabel><content src="chap1.xhtml"/></navPoint>
    <navPoint id="np2" playOrder="2"><navLabel><text>第二章 古城遗迹</text></navLabel><content src="chap2.xhtml"/></navPoint>
    <navPoint id="np3" playOrder="3"><navLabel><text>第三章 神秘老人</text></navLabel><content src="chap3.xhtml"/></navPoint>
  </navMap>
</ncx>`,
);
const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>${body}</p></body></html>`;
epub.file("OEBPS/chap1.xhtml", xhtml("第一章 沙漠之旅", "少年站在沙丘上，望着远方的城池，风沙掩埋了来时的路。"));
epub.file("OEBPS/chap2.xhtml", xhtml("第二章 古城遗迹", "城池的废墟在月光下显得格外寂静，少年推开沉重的石门。"));
epub.file("OEBPS/chap3.xhtml", xhtml("第三章 神秘老人", "一个白发老人从阴影中走出，说他已经等了三十年。"));
await put("sample.epub", await epub.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

// ─── 10. 极简 docx（jszip 现场打包） ──────────────────────────
const docx = new JSZip();
docx.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
);
docx.file(
  "word/document.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>拆解测试文档</w:t></w:r></w:p>
<w:p><w:r><w:t>这是第一段正文，用于验证 docx 解析器能取到文本内容。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>小节标题</w:t></w:r></w:p>
<w:p><w:r><w:t>这是第二段正文，包含中文内容与关键信息。</w:t></w:r></w:p>
</w:body></w:document>`,
);
docx.file(
  "docProps/core.xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>拆解测试文档</dc:title>
<dc:creator>测试作者</dc:creator>
</cp:coreProperties>`,
);
await put("sample.docx", await docx.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));

console.log(`fixtures 生成完成（${written.length} 个）→ tests/fixtures/`);
for (const f of written) console.log(`  · ${f}`);
