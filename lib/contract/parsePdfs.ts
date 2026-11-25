// 결재문서(기안문) PDF와 사업자등록증 PDF에서 계약서에 들어갈 값 뽑기. 입력은 글자 좌표(pdf.js), 브라우저/Node 공용.

export type Glyph = { x: number; y: number; w: number; s: string };
export type Row = { y: number; items: Glyph[] };

/** 같은 높이의 글자를 한 줄로 (위→아래) */
export function toRows(glyphs: Glyph[]): Row[] {
  const rows: Row[] = [];
  for (const g of glyphs.filter((g) => g.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const r = rows.find((r) => Math.abs(r.y - g.y) <= 2.5);
    if (r) r.items.push(g); else rows.push({ y: g.y, items: [g] });
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));
  return rows.sort((a, b) => b.y - a.y);
}

/** 줄 글자: 글자 사이가 벌어진 곳만 띄어 쓴다 */
export function rowText(items: Glyph[], gap = 2.5) {
  let s = "", end = -Infinity;
  for (const g of items) { if (s && g.x - end > gap) s += " "; s += g.s; end = g.x + g.w; }
  return s.replace(/\s+/g, " ").trim();
}
const flat = (s: string) => s.replace(/\s/g, "");

// ---------- 결재문서 ----------
export type DraftInfo = { title: string; name: string; amount: number | null; period: string; place: string; date: string };

export function parseDraft(rows: Row[]): DraftInfo {
  const lines = rows.map((r) => rowText(r.items));
  const out: DraftInfo = { title: "", name: "", amount: null, period: "", place: "", date: "" };
  for (const l of lines) {
    const t = l.match(/^제\s*목\s+(.+)$/);
    if (t && !out.title) out.title = t[1].trim();
    // "1. 보 수 명: …", "2. 보수기간: …"
    const m = l.match(/^\d+\s*\.\s*([^:：]{1,15}?)\s*[:：]\s*(.+)$/);
    if (m) {
      const k = flat(m[1]), v = m[2].trim();
      if (/명$/.test(k) && !out.name) out.name = v;
      else if (/기간|기한/.test(k) && !out.period) out.period = v;
      else if (/위치|장소/.test(k) && !out.place) out.place = v;
      else if (/금액/.test(k) && out.amount === null) { const n = v.replace(/\s/g, "").match(/금?([\d,]+)원/); if (n) out.amount = Number(n[1].replace(/,/g, "")); }
    }
    const d = l.replace(/\s/g, "").match(/(?:전결|결재|시행)(\d{4})\.(\d{1,2})\.(\d{1,2})\./);
    if (d && !out.date) out.date = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
  }
  if (!out.name) out.name = out.title;
  return out;
}

// ---------- 사업자등록증 ----------
export type BizInfo = { bizNo: string; company: string; ceo: string; address: string; entity: "개인" | "법인"; industries: string[] };

/** (주)·（주）·주식회사 → ㈜ */
export const normCompany = (s: string) => s.replace(/[（(]\s*주\s*[)）]\s*/g, "㈜").replace(/^주식회사\s*/, "㈜").replace(/\s*주식회사$/, "").trim();

export function parseBizCert(rows: Row[]): BizInfo {
  const out: BizInfo = { bizNo: "", company: "", ceo: "", address: "", entity: "개인", industries: [] };
  const lines = rows.map((r) => ({ r, text: rowText(r.items) }));
  const all = flat(lines.map((l) => l.text).join("\n"));
  if (/법인사업자/.test(all)) out.entity = "법인";
  /** "칸이름 : 값" — 칸이름은 글자 사이 띄어쓰기가 제각각이라 공백 없이 비교 */
  const value = (label: RegExp) => {
    for (const { text } of lines) {
      const i = text.search(/[:：]/);
      if (i > 0 && label.test(flat(text.slice(0, i)))) return text.slice(i + 1).trim();
    }
    return "";
  };
  const no = all.match(/등록번호[:：](\d{3}-\d{2}-\d{5})/);
  if (no) out.bizNo = no[1];
  out.company = normCompany(value(/^(법인명\(단체명\)|상호\(법인명\)|상호|법인명)$/));
  out.ceo = value(/^(대표자\(대표유형\)|대표자|성명)$/).replace(/\s*\([^)]*\)/g, "").split(/\s*,\s*/).filter(Boolean).join(", ");
  out.address = value(/^사업장소재지$/);
  // 사업의 종류: 업태(왼쪽) · 종목(오른쪽) 줄마다
  const start = lines.findIndex((l) => /^사업의종류/.test(flat(l.text)));
  if (start >= 0) {
    // "종목" 머리글의 x 위치 (글자가 "종","목"으로 따로 있거나 "종목" 한 덩어리)
    const its = lines[start].r.items;
    const ki = its.findIndex((g, i) => /종목/.test(g.s) || (g.s === "종" && its[i + 1]?.s === "목"));
    const kindX = ki >= 0 ? its[ki].x : 360;
    for (let i = start; i < lines.length; i++) {
      const { r, text } = lines[i];
      if (i > start && /^(발급사유|공동사업자|사업자단위|전자세금계산서)/.test(flat(text))) break;
      const colon = r.items.findIndex((g) => /[:：]/.test(g.s));
      const body = r.items.slice(colon + 1);
      const left = rowText(body.filter((g) => g.x < kindX - 5)).replace(/^업태\s*/, "").trim();
      const right = rowText(body.filter((g) => g.x >= kindX - 5)).replace(/^종목\s*/, "").trim();
      if (!left && !right) continue;
      out.industries.push(right ? `${left}(${right})` : left);
    }
  }
  return out;
}

// ---------- 날짜·금액 계산 ----------
/** 결재문서의 "착공일로부터 30일 이내" → 계약서 표기 "계약일로부터 30일 이내" */
export const contractTerm = (period: string) => period.replace(/^(착공일|착수일|공사착공일)/, "계약일");
/** 기간 문구에서 일수 (준공일 제안용) */
export const termDays = (period: string) => { const m = period.match(/(\d+)\s*일/); return m ? +m[1] : null; };
