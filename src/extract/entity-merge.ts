// ============================================================
// 跨维度实体归并
// ------------------------------------------------------------
// 原型完全没有这一步，于是「萧炎」「炎帝」「萧家三少」在角色卡、情节脉络、
// 伏笔三个维度里是三个互不相干的人，后面根本没法做实体对齐和注入。
//
// 归并规则（按可信度从高到低）：
//   1. 归一化后同名
//   2. 别名集合相交（A 的别名里有 B 的名字）
//   3. 包含关系 + 后缀是称谓（萧炎 ⊂ 炎帝？不成立；但 萧炎 ⊂ 萧炎大哥 成立）
//      —— 只在「多出来的部分是称谓」时才合并，避免把不同人物误并。
// ============================================================

import type { EntityMention, MergedEntity } from "../types.js";

/** 称谓/敬语后缀：出现这些后缀时，去掉后仍视为同一实体 */
const AFFIXES = [
  "大帝", "帝", "尊者", "尊", "圣人", "圣", "老祖", "老怪", "老魔", "老爷", "老", "少爷", "少主", "少", 
  "大人", "大人", "阁主", "宗主", "门主", "教主", "掌门", "城主", "家主", "族长", "殿下", "陛下",
  "公子", "小姐", "姑娘", "前辈", "后辈", "道友", "道人", "真人", "仙人", "上仙", "仙子", "神", "君",
  "先生", "女士", "老师", "师傅", "师父", "同学", "兄弟", "大哥", "二哥", "三哥", "大哥", "小弟",
  "同学", "教授", "博士", "医生", "队长", "团长", "将军", "陛下", "王", "皇", "后", "妃",
  "the Great", "the Elder", "Jr.", "Sr.", "Mr.", "Mrs.", "Ms.", "Dr.",
];

/** 归一化：全角转半角、去空格、去包裹性标点、小写 */
export function normalizeName(raw: string): string {
  if (!raw) return "";
  let s = raw.normalize("NFKC").trim().toLowerCase();
  // 去掉括号内容与常见修饰标点
  s = s.replace(/[（(][^）)]*[）)]/g, "");
  s = s.replace(/[《》〈〉「」『』"'"'`,，、。！？：；·\-—_~!?:;.]|\s+/g, "");
  return s;
}

/** 去掉称谓后缀后的“核心名” */
export function stripAffixes(normalized: string): string {
  let s = normalized;
  let changed = true;
  while (changed) {
    changed = false;
    for (const affix of AFFIXES) {
      const a = affix.toLowerCase().replace(/\s+/g, "");
      if (a && s.length > a.length && s.endsWith(a)) {
        s = s.slice(0, s.length - a.length);
        changed = true;
      }
    }
  }
  return s;
}

/** 两个归一化后的名字是否应视为同一实体 */
export function shouldMerge(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = stripAffixes(a);
  const cb = stripAffixes(b);
  if (ca === cb && ca.length >= 2) return true;
  // 包含关系：一方是另一方的子串，且短的那方长度>=2（避免单字误并）
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 2 && longer.includes(shorter)) {
    const extra = longer.replace(shorter, "");
    // 多出来的部分必须“像称谓”而不是另一个名字
    if (extra.length <= 4 && AFFIXES.some((af) => af.toLowerCase().replace(/\s+/g, "") === extra)) {
      return true;
    }
  }
  return false;
}

class DSU {
  private parent = new Map<number, number>();

  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root)! !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur)! !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * 把散落在各 chunk / 各维度的实体提及归并成实体表。
 * 复杂度做了控制：候选按归一化名建桶，只在桶内及别名相交处做两两比较。
 */
export function mergeEntities(mentions: EntityMention[]): MergedEntity[] {
  const cleaned = mentions
    .map((m) => ({ ...m, name: (m.name ?? "").trim() }))
    .filter((m) => m.name.length > 0 && m.name.length <= 40);

  const dsu = new DSU();

  // 索引：归一化名 → 提及下标
  const byNorm = new Map<string, number[]>();
  cleaned.forEach((m, i) => {
    const n = normalizeName(m.name);
    if (!n) return;
    const list = byNorm.get(n);
    if (list) list.push(i);
    else byNorm.set(n, [i]);
    // 别名也要建立指向，用于规则 2
    for (const alias of m.aliases ?? []) {
      const an = normalizeName(alias);
      if (!an) continue;
      const l = byNorm.get(an);
      if (l) l.push(i);
      else byNorm.set(an, [i]);
    }
  });

  // 规则 1 & 2：同一个归一化键下的所有提及合并
  for (const idxs of byNorm.values()) {
    for (let k = 1; k < idxs.length; k++) dsu.union(idxs[0]!, idxs[k]!);
  }

  // 规则 3：称谓包含关系（只在归一化键两两之间做，规模有限）
  const keys = [...byNorm.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (shouldMerge(keys[i]!, keys[j]!)) {
        dsu.union(byNorm.get(keys[i]!)![0]!, byNorm.get(keys[j]!)![0]!);
      }
    }
  }

  // 分组
  const groups = new Map<number, number[]>();
  cleaned.forEach((_, i) => {
    const root = dsu.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });

  const entities: MergedEntity[] = [];
  let seq = 1;
  for (const idxs of groups.values()) {
    const group = idxs.map((i) => cleaned[i]!);

    // 出现次数最多的原始名作为 canonical（同票取更短的，更像本名）
    const counter = new Map<string, number>();
    for (const g of group) {
      const key = g.name;
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
    const canonical = [...counter.entries()].sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].length - b[0].length;
    })[0]![0];

    const aliasSet = new Set<string>();
    for (const g of group) {
      if (g.name !== canonical) aliasSet.add(g.name);
      for (const a of g.aliases ?? []) {
        const t = a.trim();
        if (t && t !== canonical) aliasSet.add(t);
      }
    }

    const typeCounter = new Map<string, number>();
    for (const g of group) if (g.type) typeCounter.set(g.type, (typeCounter.get(g.type) ?? 0) + 1);
    const type =
      [...typeCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      group.find((g) => g.type)?.type ??
      "unknown";

    const descriptions = dedupeStrings(group.map((g) => g.description ?? "").filter(Boolean));

    entities.push({
      id: `ent-${String(seq++).padStart(3, "0")}`,
      canonical,
      aliases: [...aliasSet].slice(0, 20),
      type,
      descriptions: descriptions.slice(0, 6),
      mentionCount: group.length,
      sourceChunkIds: [...new Set(group.map((g) => g.sourceChunkId))],
    });
  }

  // 提及多的排前面，便于下游取 top-N
  return entities.sort((a, b) => b.mentionCount - a.mentionCount || a.canonical.localeCompare(b.canonical));
}

/** 去重：按前 24 字的指纹判重，保留最长的描述 */
function dedupeStrings(list: string[]): string[] {
  const map = new Map<string, string>();
  for (const s of list) {
    const fp = s.replace(/\s+/g, "").slice(0, 24);
    const prev = map.get(fp);
    if (!prev || s.length > prev.length) map.set(fp, s);
  }
  return [...map.values()];
}
