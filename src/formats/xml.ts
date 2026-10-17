// ============================================================
// 极简 XML 工具
// ------------------------------------------------------------
// 为什么不用 xml 解析库：epub/docx 的结构足够规整，正则即可稳定抽取，
// 少一个依赖就少一个安装失败点（本项目刻意保持轻量，禁止重型框架）。
// ============================================================

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/** 解码 XML/HTML 实体（含数字实体） */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** 去掉所有标签，返回纯文本（块级标签补换行） */
export function stripTags(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|tr|table|section)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );
}

/** 取第一个匹配标签的 innerXML */
export function tagInner(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  return m?.[1];
}

/** 取标签全部出现（含属性串与 inner） */
export function allTags(xml: string, tag: string): { attrs: string; inner: string }[] {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const out: { attrs: string; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? "", inner: m[2] ?? "" });
  }
  return out;
}

/** 取标签全部出现（自闭合标签也支持） */
export function allTagsLoose(xml: string, tag: string): { attrs: string; inner: string }[] {
  const re = new RegExp(`<${tag}(\\s[^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, "gi");
  const out: { attrs: string; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({ attrs: m[1] ?? "", inner: m[2] ?? "" });
  }
  return out;
}

/** 取某个属性值 */
export function attr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = attrs.match(re);
  return m?.[2] ?? m?.[3];
}
