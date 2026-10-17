// ============================================================
// .docx 解析（jszip 读 word/document.xml 剥标签取文本）
// ------------------------------------------------------------
// 关键点：标题样式（Heading1/2/3 或「标题 1」）就是自带目录，
// 必须提出来当 toc，比正则猜章节可靠得多。
// ============================================================

import JSZip from "jszip";
import type { ParsedDocument, TocEntry } from "../types.js";
import { allTags, attr, stripTags, tagInner } from "./xml.js";
import { collapseBlankLines } from "./common.js";

export async function parseDocx(buf: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("不是合法 docx：缺少 word/document.xml");
  const xml = await docFile.async("string");

  const lines: string[] = [];
  const toc: TocEntry[] = [];
  let cursor = 0;

  for (const p of allTags(xml, "w:p")) {
    // 段落文本 = 所有 <w:t> 内容拼接（tab/换行节点忽略）
    let text = "";
    for (const t of allTags(p.inner, "w:t")) text += stripTags(t.inner);
    text = text.trim();

    const styleId = attr(attrBlock(p.inner), "w:val");
    const level = headingLevel(styleId);

    if (!text) continue;

    if (level > 0) {
      toc.push({ title: text, level, offset: cursor });
    }
    lines.push(text);
    cursor += text.length + 1;
  }

  const coreFile = zip.file("docProps/core.xml");
  let title: string | undefined;
  let author: string | undefined;
  if (coreFile) {
    const core = await coreFile.async("string");
    title = tagInner(core, "dc:title") ? stripTags(tagInner(core, "dc:title")!).trim() : undefined;
    author = tagInner(core, "dc:creator") ? stripTags(tagInner(core, "dc:creator")!).trim() : undefined;
  }

  return {
    text: collapseBlankLines(lines.join("\n")),
    meta: { title, author },
    toc: toc.length > 0 ? toc : undefined,
    format: "docx",
  };
}

/** 取段落的 pStyle 属性块（w:pPr → w:pStyle） */
function attrBlock(paragraphInner: string): string {
  const pPr = tagInner(paragraphInner, "w:pPr");
  if (!pPr) return "";
  const style = allTagsLooseGeneric(pPr, "w:pStyle")[0];
  return style ?? "";
}

function allTagsLooseGeneric(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(\\s[^>]*?)(?:/>|>)`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1] ?? "");
  return out;
}

/** 把 Word 样式名映射为标题层级，非标题返回 0 */
export function headingLevel(styleId: string | undefined): number {
  if (!styleId) return 0;
  const m = styleId.match(/^Heading\s*(\d)$/i) ?? styleId.match(/^标题\s*(\d)$/);
  if (m) return Number(m[1]);
  if (/^Heading$/i.test(styleId) || styleId === "标题") return 1;
  if (/^Title$/i.test(styleId)) return 1;
  return 0;
}
