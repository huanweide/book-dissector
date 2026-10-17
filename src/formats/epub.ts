// ============================================================
// .epub 解析（只用 jszip 自己解析 OPF / spine / NCX，不引全量 epub 库）
// ------------------------------------------------------------
// 关键点：
//   1. 只跟随 spine 的 linear 顺序读正文，避免把封面/版权/注释混进来
//   2. NCX（EPUB2）/ nav.xhtml（EPUB3）目录优先被当作 toc 交给分章引擎
//   3. 每个 spine 文档的起始偏移会被记录，用于目录条目回填定位
// ============================================================

import JSZip from "jszip";
import type { ParsedDocument, TocEntry } from "../types.js";
import { allTags, allTagsLoose, attr, decodeEntities, stripTags, tagInner } from "./xml.js";
import { collapseBlankLines } from "./common.js";

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export async function parseEpub(buf: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buf);

  // ── 1. 定位 OPF ────────────────────────────────────────────
  const containerXml = await readZipText(zip, "META-INF/container.xml");
  if (!containerXml) throw new Error("不是合法 epub：缺少 META-INF/container.xml");

  const rootfile = allTagsLoose(containerXml, "rootfile").map((r) => attr(r.attrs, "full-path"))[0];
  if (!rootfile) throw new Error("不是合法 epub：container.xml 中没有 rootfile");

  const opfText = await readZipText(zip, rootfile);
  if (!opfText) throw new Error(`不是合法 epub：找不到 OPF 文件 ${rootfile}`);

  const opfDir = rootfile.includes("/") ? rootfile.slice(0, rootfile.lastIndexOf("/")) : "";

  // ── 2. 元数据 ──────────────────────────────────────────────
  const metaBlock = tagInner(opfText, "metadata") ?? opfText;
  const title = firstText(metaBlock, ["dc:title"]);
  const author = firstText(metaBlock, ["dc:creator"]);
  const language = firstText(metaBlock, ["dc:language"]);

  // ── 3. manifest ────────────────────────────────────────────
  const manifest = new Map<string, ManifestItem>();
  for (const it of allTagsLoose(opfText, "item")) {
    const id = attr(it.attrs, "id");
    const href = attr(it.attrs, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: attr(it.attrs, "media-type") ?? "",
      properties: attr(it.attrs, "properties"),
    });
  }

  // ── 4. spine（正文顺序） ───────────────────────────────────
  const spineIds: string[] = [];
  for (const it of allTagsLoose(opfText, "itemref")) {
    const idref = attr(it.attrs, "idref");
    if (!idref) continue;
    // linear="no" 的内容（页眉、注释、封面）不参与正文
    if ((attr(it.attrs, "linear") ?? "yes").toLowerCase() === "no") continue;
    spineIds.push(idref);
  }

  // ── 5. 目录：优先 NCX，其次 EPUB3 nav.xhtml ────────────────
  let toc: TocEntry[] = [];
  const ncxItem = [...manifest.values()].find(
    (m) => m.mediaType === "application/x-dtbncx+xml" || /\.ncx$/i.test(m.href),
  );
  if (ncxItem) {
    const ncx = await readZipText(zip, joinPath(opfDir, ncxItem.href));
    if (ncx) toc = parseNcx(ncx);
  }
  if (toc.length === 0) {
    const navItem = [...manifest.values()].find(
      (m) => (m.properties ?? "").split(/\s+/).includes("nav") || /nav\.x?html$/i.test(m.href),
    );
    if (navItem) {
      const nav = await readZipText(zip, joinPath(opfDir, navItem.href));
      if (nav) toc = parseNavXhtml(nav);
    }
  }

  // ── 6. 按 spine 顺序抽正文 ─────────────────────────────────
  const parts: string[] = [];
  let cursor = 0;
  /** 每个 spine 文档的起始偏移，用于给 toc 回填位置 */
  const docStarts: { href: string; start: number }[] = [];

  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (!/x?html|xml/i.test(item.mediaType) && !/\.(x?html|xml)$/i.test(item.href)) continue;
    const docXml = await readZipText(zip, joinPath(opfDir, item.href));
    if (!docXml) continue;
    const body = tagInner(docXml, "body") ?? docXml;
    const text = collapseBlankLines(stripTags(body));
    if (!text) continue;
    docStarts.push({ href: item.href, start: cursor });
    parts.push(text);
    cursor += text.length + 2;
  }

  const fullText = collapseBlankLines(parts.join("\n\n"));

  // ── 7. 给 toc 回填偏移 ────────────────────────────────────
  if (toc.length > 0) {
    let searchFrom = 0;
    for (const entry of toc) {
      const offset = fullText.indexOf(entry.title, searchFrom);
      if (offset >= 0) {
        entry.offset = offset;
        searchFrom = offset + entry.title.length;
      }
    }
    // 全部定位失败（常见于目录用简称）时退化为不回填，交由分章引擎按标题匹配
    if (toc.every((t) => t.offset === undefined)) {
      for (const t of toc) delete t.offset;
    }
  }

  return {
    text: fullText,
    meta: { title, author, language },
    toc: toc.length > 0 ? toc : undefined,
    format: "epub",
  };
}

/** 解析 EPUB2 NCX 的 navMap */
export function parseNcx(ncx: string): TocEntry[] {
  const out: TocEntry[] = [];
  const seen = new Set<string>();
  for (const point of allTags(ncx, "navPoint")) {
    const label = tagInner(point.inner, "text");
    if (!label) continue;
    const title = decodeEntities(stripTags(label)).trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    // playOrder 决定层级：这里用嵌套深度近似
    out.push({ title, level: 1 });
  }
  return out;
}

/** 解析 EPUB3 nav.xhtml 的 <nav> → <ol>/<li>/<a> */
export function parseNavXhtml(nav: string): TocEntry[] {
  const out: TocEntry[] = [];
  const seen = new Set<string>();
  const navBlock = allTags(nav, "nav").find((n) => /toc|table-of-contents/i.test(n.attrs)) ?? allTags(nav, "nav")[0];
  const scope = navBlock ? navBlock.inner : nav;
  for (const a of allTags(scope, "a")) {
    const title = decodeEntities(stripTags(a.inner)).trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, level: 1 });
  }
  return out;
}

// ── 小工具 ──────────────────────────────────────────────────

async function readZipText(zip: JSZip, path: string): Promise<string | undefined> {
  const file = zip.file(path) ?? zip.file(normalizeZipPath(zip, path));
  if (!file) return undefined;
  return await file.async("string");
}

/** 兼容 OPF 里 href 带 ./ 或大小写差异的情况 */
function normalizeZipPath(zip: JSZip, path: string): string {
  const clean = joinPath("", path);
  const found = Object.keys(zip.files).find((p) => p === clean || p.toLowerCase() === clean.toLowerCase());
  return found ?? path;
}

function joinPath(dir: string, href: string): string {
  const raw = dir ? `${dir}/${href}` : href;
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return decodeURIComponent(stack.join("/"));
}

function firstText(xml: string, tags: string[]): string | undefined {
  for (const t of tags) {
    const inner = tagInner(xml, t);
    if (inner) {
      const v = stripTags(inner).trim();
      if (v) return v;
    }
  }
  return undefined;
}
