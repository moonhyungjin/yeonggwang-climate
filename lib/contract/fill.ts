// 계약서 hwpx 채우기.
// 서식은 이전에 작성한 계약서(값이 채워진 hwpx)다. 칸 이름(계약명·계약금액·상호…)으로 서식에 들어 있던 값을 찾고,
// 문서 전체에서 그 값을 새 값으로 바꾼다. 값이 글자 모양이 다른 여러 조각(run)에 걸쳐 있어도 바꾸며, 조각의 글자 모양은 유지한다.
// 여기서는 XML 문자열만 다룬다(브라우저/Node 공용). 계약 내용은 코드에 넣지 않는다.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const flat = (s: string) => s.replace(/\s/g, "");

// 가장 안쪽 문단(표가 들어 있지 않은 문단)
const INNER_P = /<hp:p [^>]*>(?:(?!<hp:p )[\s\S])*?<\/hp:p>/g;

/** 문단의 보이는 글자 (표 계산식 필드 제외) */
function paraText(p: string) {
  return [...p.replace(/<hp:fieldBegin[\s\S]*?<\/hp:fieldBegin>/g, "").matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)]
    .map((m) => unesc(m[1].replace(/<[^>]+>/g, "")))
    .join("");
}

export type Para = { sec: number; idx: number; text: string };

/** 섹션별 문단 글자 목록 (문서 순서) */
export function paragraphs(sections: string[]): Para[] {
  return sections.flatMap((x, sec) => [...x.matchAll(INNER_P)].map((m, idx) => ({ sec, idx, text: paraText(m[0]) })));
}

// ---------- 치환 ----------
export type Rule = { find: string; repl: string; at?: { sec: number; idx: number }[] }; // at: 이 문단에서만

/** 문단 하나에서 규칙대로 바꾸기. 앞 규칙이 먼저 자리를 차지한다(칸 지정 규칙을 앞에 둔다) */
function replaceInPara(p: string, rules: Rule[]): string {
  // <hp:t> 안 글자 조각들 (줄바꿈·탭 같은 태그는 그대로 두고 글자만 대상)
  type Seg = { tStart: number; tEnd: number; parts: { tag?: string; text?: string }[] };
  const segs: Seg[] = [];
  for (const m of p.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)) {
    const inner = m[1];
    const parts = inner.split(/(<[^>]+>)/).filter((x) => x !== "").map((x) => (x.startsWith("<") ? { tag: x } : { text: unesc(x) }));
    const open = "<hp:t>".length;
    segs.push({ tStart: m.index! + open, tEnd: m.index! + open + inner.length, parts });
  }
  // 전체 글자와 (조각, 위치) 대응표
  const chars: { s: number; p: number; o: number }[] = [];
  let all = "";
  segs.forEach((g, s) => g.parts.forEach((pt, pi) => { if (pt.text !== undefined) for (let o = 0; o < pt.text.length; o++) { chars.push({ s, p: pi, o }); all += pt.text[o]; } }));
  if (!all) return p;

  // 겹치지 않게 찾기
  const hits: { a: number; b: number; repl: string }[] = [];
  for (const r of rules) {
    if (!r.find || r.find === r.repl) continue;
    let from = 0, i: number;
    while ((i = all.indexOf(r.find, from)) >= 0) {
      const b = i + r.find.length;
      if (!hits.some((h) => i < h.b && b > h.a)) hits.push({ a: i, b, repl: r.repl });
      from = b;
    }
  }
  if (!hits.length) return p;

  // 글자별 새 내용: 길이가 같으면 글자마다 제자리(조각별 글자 모양 유지), 다르면 첫 글자 자리에 통째로
  const out: (string | null)[] = all.split("");
  for (const h of hits) {
    if (h.b - h.a === h.repl.length) for (let k = 0; k < h.repl.length; k++) out[h.a + k] = h.repl[k];
    else { out[h.a] = h.repl; for (let k = h.a + 1; k < h.b; k++) out[k] = null; }
  }
  // 조각 다시 쓰기
  const newText: (string | undefined)[][] = segs.map((g) => g.parts.map((pt) => (pt.text !== undefined ? "" : undefined)));
  chars.forEach((c, k) => { if (out[k] !== null) newText[c.s][c.p] = (newText[c.s][c.p] ?? "") + out[k]; });
  let res = "", last = 0;
  segs.forEach((g, s) => {
    const inner = g.parts.map((pt, pi) => (pt.tag ?? esc(newText[s][pi] ?? ""))).join("");
    res += p.slice(last, g.tStart) + inner; last = g.tEnd;
  });
  return res + p.slice(last);
}

/** 모든 섹션에 규칙 적용 */
export function applyRules(sections: string[], rules: Rule[]): string[] {
  return sections.map((x, sec) => {
    let idx = -1;
    return x.replace(INNER_P, (p) => {
      idx++;
      const here = rules.filter((r) => r.at?.some((a) => a.sec === sec && a.idx === idx));
      const global = rules.filter((r) => !r.at);
      return replaceInPara(p, [...here, ...global]);
    });
  });
}

// ---------- 서식에서 기존 값 찾기 ----------
export type FieldKey =
  | "name" | "amount" | "payAmount" | "bond" | "delayRate" | "term" | "place" | "etc"
  | "company" | "ceo" | "address" | "bizNo" | "phone"
  | "contractDate" | "orderDate" | "doneDate" | "kind" | "entity" | "workType" | "defect" | "industries";

export type Found = { text: string; at?: { sec: number; idx: number }[] };
export type TemplateInfo = { found: Partial<Record<FieldKey, Found>>; industryParas: Para[] };

const DATE_DOT = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/;

export function readTemplate(sections: string[]): TemplateInfo {
  const P = paragraphs(sections);
  const T = (p: Para) => p.text.trim();
  const at = (p: Para) => [{ sec: p.sec, idx: p.idx }];
  /** 칸 이름 다음의 첫 값 문단 */
  const after = (label: RegExp): Para | null => {
    const i = P.findIndex((p) => label.test(flat(p.text)));
    if (i < 0) return null;
    return P.slice(i + 1).find((p) => T(p)) ?? null;
  };
  /** "∙ 상  호: 값" 꼴 */
  const labeled = (label: RegExp): Para | null => P.find((p) => label.test(T(p))) ?? null;
  const found: TemplateInfo["found"] = {};
  const put = (k: FieldKey, p: Para | null, text?: string, anchored = false) => {
    if (!p) return;
    const t = (text ?? T(p)).trim();
    if (t) found[k] = anchored ? { text: t, at: at(p) } : { text: t };
  };

  put("name", after(/^계약명$/));
  put("amount", after(/^계약금액$/));
  put("payAmount", after(/^지급금액$/), undefined, true);
  put("bond", after(/^계약보증금$/));
  put("delayRate", after(/^지체상금율$/));
  put("term", after(/^계약기한$/));
  put("place", after(/^(납품장소|납품|이행장소|공사장소)$/));
  put("etc", after(/^기타$/), undefined, true);

  const val = (re: RegExp) => { const p = labeled(re); return p ? { p, v: T(p).replace(re, "").trim() } : null; };
  const co = val(/^∙?\s*상\s*호\s*[:：]\s*/), ad = val(/^∙?\s*주\s*소\s*[:：]\s*/), ce = val(/^∙?\s*대\s*표\s*자\s*[:：]\s*/);
  if (co?.v) found.company = { text: co.v };
  if (ad?.v) found.address = { text: ad.v };
  if (ce?.v) found.ceo = { text: ce.v.replace(/\s*\(인\)\s*$/, "") };
  // "∙ 사업자등록번호:" 다음 줄 (같은 줄에 있을 수도)
  const bz = val(/^∙?\s*사업자등록번호\s*[:：]\s*/);
  if (bz) put("bizNo", bz.v ? bz.p : P.slice(P.indexOf(bz.p) + 1).find((p) => T(p)) ?? null, bz.v || undefined);
  const ph = val(/^∙?\s*전화번호\s*[:：]\s*/);
  if (ph) put("phone", ph.v ? ph.p : P.slice(P.indexOf(ph.p) + 1).find((p) => T(p)) ?? null, ph.v || undefined);

  // 계약일: 표준계약서 본문 아래 첫 날짜
  const d = P.find((p) => DATE_DOT.test(T(p)));
  if (d) found.contractDate = { text: T(d) };
  put("orderDate", after(/^발주날짜$/), undefined, true);
  put("doneDate", after(/^준공일자$/), undefined, true);

  // 체크 칸: [ ] 공사 [ ] 물품 [√] 용역 / [ ] 개인 [√] 법인
  const kind = P.find((p) => /\[[^\]]*\]\s*공사.*\[[^\]]*\]\s*물품.*\[[^\]]*\]\s*용역/.test(p.text));
  if (kind) found.kind = { text: kind.text, at: at(kind) };
  const ent = P.find((p) => /\[[^\]]*\]\s*개인.*\[[^\]]*\]\s*법인/.test(p.text));
  if (ent) found.entity = { text: ent.text, at: at(ent) };

  // 하자보수: 공종(책임기한 머리글 다음 칸), "(2%) 금26,300원"
  put("workType", after(/^하자담보책임기한$/), undefined, true);
  const df = P.find((p) => /^\(\s*[\d.]+\s*%\s*\)\s*금[\d,]*원$/.test(T(p)));
  if (df) found.defect = { text: T(df) };

  // 업종(등록): 칸 이름 다음의 "업태(종목)" 줄들
  const li = P.findIndex((p) => /^업종(\(등록\))?$/.test(flat(p.text)));
  const industryParas: Para[] = [];
  if (li >= 0) for (const p of P.slice(li + 1)) { if (!T(p)) continue; if (!/\S.*\(.+\)$/.test(T(p)) || T(p).length > 60) break; industryParas.push(p); }
  if (industryParas.length) found.industries = { text: industryParas.map(T).join("\n") };

  return { found, industryParas };
}

// ---------- 새 값 → 규칙 ----------
export type ContractData = {
  name: string; amount: number; payAmount: number; bond: number; delayRate: string; term: string; place: string; etc: string;
  company: string; ceo: string; address: string; bizNo: string; phone: string; entity: "개인" | "법인";
  industries: string[]; kind: "공사" | "물품" | "용역";
  contractDate: string; orderDate: string; doneDate: string; // yyyy-mm-dd
  workType: string; defectRate: number; defectAmount: number;
};

const DIG = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
/** 1315600 → "일백삼십일만오천육백" (계약서 표기: 1도 '일'을 붙여 쓴다) */
export function koreanNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "영";
  const big = ["", "만", "억", "조"];
  let s = "", g = 0;
  n = Math.floor(n);
  while (n > 0) {
    const part = n % 10000;
    if (part) {
      const d = [Math.floor(part / 1000), Math.floor(part / 100) % 10, Math.floor(part / 10) % 10, part % 10];
      const t = d.map((x, i) => (x ? DIG[x] + ["천", "백", "십", ""][i] : "")).join("");
      s = t + big[g] + s;
    }
    n = Math.floor(n / 10000); g++;
  }
  return s;
}
export const moneyText = (n: number) => `금${n.toLocaleString()}원(금${koreanNumber(n)}원)`;

/** 2026-11-23 → "2026. 11. 23." */
export const dotDate = (iso: string) => { const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${+m[1]}. ${+m[2]}. ${+m[3]}.` : ""; };
const parseDot = (s: string) => { const m = s.trim().match(DATE_DOT); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };

/** 체크 칸 문단의 새 글자: 고른 항목만 [√], 나머지는 원래 빈칸 폭 그대로 */
function checkText(old: string, options: string[], pick: string) {
  const blank = old.match(/\[(\s+)\]/)?.[1] ?? " ";
  return old.replace(new RegExp(`\\[([^\\]]*)\\](\\s*)(${options.join("|")})`, "g"), (_m, inner: string, sp: string, opt: string) => {
    const on = opt === pick;
    const width = inner.includes("√") ? blank : inner; // 빈칸 폭은 서식의 빈칸 폭
    return `[${on ? "√" : width}]${sp}${opt}`;
  });
}

export type Change = { key: FieldKey; label: string; from: string; to: string; missing?: boolean };

const LABELS: Record<FieldKey, string> = {
  name: "계약명", amount: "계약금액", payAmount: "지급금액", bond: "계약보증금", delayRate: "지체상금율", term: "계약기한", place: "납품장소", etc: "기타",
  company: "상호", ceo: "대표자", address: "주소", bizNo: "사업자등록번호", phone: "전화번호",
  contractDate: "계약일", orderDate: "발주날짜", doneDate: "준공일자", kind: "계약 종류", entity: "개인/법인", workType: "공종", defect: "하자보수보증금", industries: "업종(등록)",
};

/** 서식 값 → 새 값 규칙과 바뀌는 내용 목록 */
export function buildRules(info: TemplateInfo, d: ContractData): { rules: Rule[]; changes: Change[] } {
  const f = info.found;
  const rules: Rule[] = [], changes: Change[] = [];
  const add = (key: FieldKey, to: string, extra: Rule[] = []) => {
    const from = f[key];
    changes.push({ key, label: LABELS[key], from: from?.text ?? "", to, missing: !from });
    if (!from) return;
    rules.push({ find: from.text, repl: to, at: from.at }, ...extra);
  };

  // 칸을 지정한 규칙이 먼저 자리를 잡도록 지정 규칙부터
  add("payAmount", moneyText(d.payAmount));
  add("etc", d.etc);
  add("orderDate", dotDate(d.orderDate));
  add("doneDate", dotDate(d.doneDate));
  add("workType", d.workType);
  if (f.kind) add("kind", checkText(f.kind.text, ["공사", "물품", "용역"], d.kind)); else add("kind", d.kind);
  if (f.entity) add("entity", checkText(f.entity.text, ["개인", "법인"], d.entity)); else add("entity", d.entity);
  // 업종: 서식의 줄 수에 맞춰 줄마다 바꾸고, 남는 줄은 비우고, 모자라면 마지막 줄에 이어 쓴다
  {
    const olds = info.industryParas, news = d.industries.filter(Boolean);
    changes.push({ key: "industries", label: LABELS.industries, from: olds.map((p) => p.text.trim()).join("\n"), to: news.join("\n"), missing: !olds.length });
    olds.forEach((p, i) => {
      const to = i < olds.length - 1 ? news[i] ?? "" : news.slice(i).join(", ");
      rules.push({ find: p.text.trim(), repl: to, at: [{ sec: p.sec, idx: p.idx }] });
    });
  }

  // 문서 전체에서 바꾸는 값
  add("name", d.name);
  add("amount", moneyText(d.amount));
  add("bond", moneyText(d.bond));
  add("delayRate", d.delayRate);
  add("term", d.term);
  add("place", d.place);
  add("company", d.company);
  // 대표자: "홍길동, 김철수"와 "홍길동,김철수" 두 표기
  const ceoNoSp = (s: string) => s.replace(/,\s+/g, ",");
  add("ceo", d.ceo, f.ceo && ceoNoSp(f.ceo.text) !== f.ceo.text ? [{ find: ceoNoSp(f.ceo.text), repl: ceoNoSp(d.ceo) }] : []);
  add("address", d.address);
  add("bizNo", d.bizNo);
  add("phone", d.phone);
  // 계약일: "2026. 11. 23."과 "2026년  11월  23일" 두 표기
  {
    const old = f.contractDate ? parseDot(f.contractDate.text) : null;
    const nw = d.contractDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const extra: Rule[] = [];
    if (old && nw) {
      const re = new RegExp(`${old.y}년(\\s*)0?${old.m}월(\\s*)0?${old.d}일`);
      // 서식 전체에서 같은 날짜의 "년 월 일" 표기를 찾아 같은 띄어쓰기로
      extra.push({ find: `__KDATE__${re.source}`, repl: `${+nw[1]}|${+nw[2]}|${+nw[3]}` });
    }
    add("contractDate", dotDate(d.contractDate), extra);
  }
  add("defect", `(${d.defectRate}%) 금${d.defectAmount.toLocaleString()}원`);
  return { rules, changes };
}

/** "__KDATE__" 규칙을 실제 문서 글자에 맞춘 일반 규칙으로 바꾸기 */
export function resolveRules(sections: string[], rules: Rule[]): Rule[] {
  const texts = paragraphs(sections).map((p) => p.text);
  return rules.flatMap((r) => {
    if (!r.find.startsWith("__KDATE__")) return [r];
    const re = new RegExp(r.find.slice(9), "g");
    const [y, m, d] = r.repl.split("|");
    const seen = new Set<string>();
    for (const t of texts) for (const mm of t.matchAll(re)) seen.add(mm[0]);
    return [...seen].map((old) => {
      const sp = old.match(/^\d{4}년(\s*)\d+월(\s*)\d+일$/)!;
      return { find: old, repl: `${y}년${sp[1]}${m}월${sp[2]}${d}일` };
    });
  });
}

/** 서식 섹션들 + 새 값 → 채운 섹션들 */
export function fillContract(sections: string[], d: ContractData) {
  const info = readTemplate(sections);
  const { rules, changes } = buildRules(info, d);
  return { sections: applyRules(sections, resolveRules(sections, rules)), changes, info };
}
