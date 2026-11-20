// PDF 숫자로 세부사업설명서 항목을 계산·제안
import { projectFunds } from "./parsePdf";
import { emptyMaster, type Funds, type Line, type MasterInfo, type Project, type Stat } from "./types";

export const mil = (thousand: number | null) => (thousand === null ? null : Math.round(thousand / 1000)); // 천원 → 백만원
const fmtN = (n: number) => (n < 0 ? "△" + Math.abs(n).toLocaleString() : n.toLocaleString());

/** 증감률(c/b) */
export function rateText(cur: number, prev: number | null) {
  if (prev === null) return "";
  if (prev === 0) return cur === 0 ? "" : "순증";
  if (cur === 0) return "순감";
  const r = ((cur - prev) / prev) * 100;
  const s = Math.abs(r).toFixed(1).replace(/\.0$/, "");
  return (r < 0 ? "△" : "") + s + "%";
}

/** "(전년도) 3,900천원 → (본) 3,900천원 / 증감없음" */
export function statChangeText(s: Pick<Stat, "cur" | "prev">) {
  const prev = s.prev ?? 0, d = s.cur - prev;
  const tail = d === 0 ? "증감없음" : `${Math.abs(d).toLocaleString()}천원 ${d > 0 ? "증" : "감"}`;
  return `(전년도) ${prev.toLocaleString()}천원 → (본) ${s.cur.toLocaleString()}천원 / ${tail}`;
}

// 통계목 이름으로 지원형태 판단
const PRIVATE_SUPPORT = ["민간경상사업보조", "민간행사사업보조", "민간자본사업보조", "민간위탁금", "민간인위탁교육비", "민간대행사업비", "사회복지사업보조"];

export function suggestSupportForm(p: Project) {
  const names = p.groups.flatMap((g) => g.stats.map((s) => s.name));
  const priv = PRIVATE_SUPPORT.filter((k) => names.includes(k));
  const direct = names.some((n) => !PRIVATE_SUPPORT.includes(n));
  return [...(direct ? ["직접수행"] : []), ...priv].join(", ");
}

const FUND_NAME: Record<string, string> = { 국: "국비", 균: "국비(균특)", 시: "시비", 군: "군비", 기: "기금" };

/** 재원 비율로 보조율 문구 제안 (자부담·일반/전환 구분은 PDF에 없어 사람이 고쳐야 함) */
export function suggestSubsidyRate(p: Project) {
  const f = projectFunds(p);
  const total = Object.values(f).reduce((s, v) => s + (v ?? 0), 0) || 1;
  return (["국", "균", "시", "기", "군"] as const)
    .filter((k) => f[k])
    .map((k) => `${FUND_NAME[k]} ${Math.round(((f[k] ?? 0) / total) * 100)}%`)
    .join(", ");
}

export const defaultPeriod = (year: number | null) => (year ? `${year}. 1월 ~ 12월` : "");

export type InvestRow = { label: "계" | "국비" | "시비" | "군비" | "기타"; a: number | null; b: number | null; c: number | null; rate: string; note: string };

/** 투자계획표 (백만원). 전년도 재원별 금액은 PDF에 없어 입력값(prevFunds)을 쓰고, 재원이 하나뿐이면 전년도 합계를 그대로 쓴다 */
export function investRows(p: Project, m: MasterInfo | null): InvestRow[] {
  const f: Funds = projectFunds(p);
  const cur = { 국비: (f.국 ?? 0) + (f.균 ?? 0), 시비: f.시 ?? 0, 군비: f.군 ?? 0, 기타: f.기 ?? 0 };
  const used = (Object.keys(cur) as (keyof typeof cur)[]).filter((k) => cur[k] > 0);
  const prevTotal = mil(p.prev ?? 0)!;
  const prevOf = (k: keyof typeof cur): number | null => {
    const v = m?.prevFunds?.[k];
    if (v !== undefined && v !== "" && !isNaN(Number(v.replace(/,/g, "")))) return Number(v.replace(/,/g, ""));
    if (used.length === 1) return k === used[0] ? prevTotal : null;
    return null;
  };
  const row = (label: InvestRow["label"], aThousand: number, b: number | null, note = ""): InvestRow => {
    const a = mil(aThousand)!;
    const show = aThousand > 0 || (b !== null && b > 0);
    return show ? { label, a, b, c: b === null ? null : a - b, rate: b === null ? "" : rateText(a, b), note } : { label, a: null, b: null, c: null, rate: "", note: "" };
  };
  return [
    row("계", p.cur, prevTotal),
    row("국비", cur.국비, prevOf("국비"), f.균 ? "균특" : ""),
    row("시비", cur.시비, prevOf("시비")),
    row("군비", cur.군비, prevOf("군비")),
    row("기타", cur.기타, prevOf("기타"), f.기 ? "기금" : ""),
  ];
}

/** 재원이 둘 이상인데 전년도 재원별 금액이 없으면 입력 필요 */
export function needsPrevFunds(p: Project, m: MasterInfo | null) {
  return investRows(p, m).some((r) => r.label !== "계" && r.a !== null && r.b === null && (p.prev ?? 0) > 0);
}

export const won = (thousand: number | null) => (thousand === null ? "" : (thousand * 1000).toLocaleString());
export const formulaText = (f: string | null) => (f ?? "").replace(/\*/g, "×");
export { fmtN };

/** 사업개요 항목 (미리보기·hwpx 공용). 값이 빈 항목은 뺀다 */
export function overviewItems(p: Project, m: MasterInfo | null, year: number | null): [string, string][] {
  const v = m ?? emptyMaster(p.name);
  const items: [string, string][] = [
    ["지원근거", v.basis], ["사업목적", v.purpose], ["사업기간", v.period || defaultPeriod(year)], ["사 업 비", `${mil(p.cur)}백만원`],
    ["사업내용", v.content], ["지원대상", v.target], ["지원형태", v.supportForm || suggestSupportForm(p)], ["보 조 율", v.subsidyRate || suggestSubsidyRate(p)],
  ];
  return items.filter(([, val]) => val.trim());
}

/** 요구 문구 찾기: 통계목 이름 → 없으면 편성목 이름 (예전 문서는 '인건비'·'여비'처럼 편성목으로 쓴 곳이 있음) */
export function reqFor(m: MasterInfo | null, group: string, stat: string, statCount = 0) {
  const r = m?.requests ?? {}, k = (x: string) => x.replace(/\s/g, "");
  const hit = r[k(stat)] ?? r[k(group)];
  if (hit !== undefined) return hit;
  // 통계목이 바뀐 경우(예: 민간경상→민간자본): 통계목도 요구 문구도 하나뿐이면 그 문구를 쓴다
  const vals = Object.values(r).filter(Boolean);
  return statCount === 1 && vals.length === 1 ? vals[0] : "";
}

/** 재원이 둘 이상인 산출 항목의 재원별 금액(원) */
export function fundNote(f: Funds) {
  const e = Object.entries(f).filter(([, v]) => v);
  return e.length > 1 ? e.map(([k, v]) => `${k} ${(v! * 1000).toLocaleString()}`).join(", ") : "";
}

/** 산출근거 표의 행 (구분 / 산출내역 / 소요비용(원) / 비고). depth 1은 ― 항목, 2는 · 항목 */
export type CalcRow = { name: string; formula: string; amount: string; note: string; depth: number };

export function calcRows(s: Stat): CalcRow[] {
  const out: CalcRow[] = [];
  const walk = (l: Line, depth: number) => {
    const mark = depth === 0 ? "" : depth === 1 ? "- " : "· ";
    out.push({ name: mark + l.name, formula: formulaText(l.formula), amount: won(l.amount), note: fundNote(l.funds), depth });
    l.children.forEach((c) => walk(c, depth + 1));
  };
  s.lines.forEach((l) => walk(l, 0));
  return out;
}

/** 산출근거에 쓰는 통계목 목록 (편성목 이름 포함) */
export const statsOf = (p: Project) => p.groups.flatMap((g) => g.stats.map((s) => ({ ...s, group: g.name })));

/** 통계목별 산출근거 형식 (기본: 글) */
export const calcStyleOf = (m: MasterInfo | null, stat: string): "text" | "table" => m?.calcStyle?.[stat.replace(/\s/g, "")] ?? "text";

/** 글 형식 산출 줄: "- 항목 6,000천원(1,000,000원×6건)", 하위 항목은 "·" */
export function calcTextLines(s: Stat): { text: string; depth: number }[] {
  const out: { text: string; depth: number }[] = [];
  const walk = (l: Line, depth: number) => {
    const amt = l.amount === null ? "" : ` ${l.amount.toLocaleString()}천원`;
    const f = formulaText(l.formula);
    out.push({ text: `${depth ? "·" : "-"} ${l.name}${amt}${f ? `(${f})` : ""}`, depth });
    l.children.forEach((c) => walk(c, depth + 1));
  };
  s.lines.forEach((l) => walk(l, 0));
  return out;
}
