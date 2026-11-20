// 세출예산사업명세서 PDF의 글자 좌표 → 세부사업 트리
// e-호조 출력 양식은 배치가 고정이라, 줄의 시작 x 위치로 단계를, 숫자의 x 위치로 열을 구분한다.
import type { BudgetDoc, FundKey, Funds, Group, Line, Project, Stat } from "./types";

export type Glyph = { x: number; y: number; w: number; s: string };

type Token = { x: number; end: number; s: string };
export type Row = { page: number; y: number; tokens: Token[] };

// 열 경계 (A4 세로, pt 단위). 숫자는 오른쪽 정렬이라 끝 위치로 판단
const COL = { fundLabel: [290, 310], cur: [310, 392], prev: [392, 478], diff: [478, 600] } as const;
// 이름 시작 위치 → 단계 (부서 46, 정책 54, 단위 63, 세부사업 71 / 편성목 82, 통계목 86, ○ 90, ― 98)
const LEVEL_X = { dept: 46, policy: 54, unit: 63, project: 71 } as const;
const HEADER_Y = 690; // 이보다 위는 페이지 머리말(제목·부서·정책·단위·열 제목)
const WRAP_X = 250; // 이름이 이 위치 전에 끝났으면 단어 경계에서 줄바꿈된 것 → 이어 붙일 때 띄어 씀

const FUND_LABELS: readonly string[] = ["국", "균", "기", "시", "군"];
const num = (s: string) => {
  const t = s.replace(/,/g, "").replace("△", "-").trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
};

/** 같은 줄 글자를 모아 토큰으로 묶는다 (글자 사이가 크게 벌어지면 다른 열) */
export function toRows(pages: Glyph[][]): Row[] {
  const rows: Row[] = [];
  pages.forEach((glyphs, pi) => {
    const byY: { y: number; gs: Glyph[] }[] = [];
    for (const g of glyphs) {
      if (!g.s.trim()) continue;
      const r = byY.find((r) => Math.abs(r.y - g.y) <= 2);
      if (r) r.gs.push(g);
      else byY.push({ y: g.y, gs: [g] });
    }
    byY.sort((a, b) => b.y - a.y);
    for (const { y, gs } of byY) {
      gs.sort((a, b) => a.x - b.x);
      const tokens: Token[] = [];
      for (const g of gs) {
        const last = tokens[tokens.length - 1];
        const gap = last ? g.x - last.end : Infinity;
        if (last && gap < 12) {
          last.s += (gap > 2.5 ? " " : "") + g.s;
          last.end = g.x + g.w;
        } else tokens.push({ x: g.x, end: g.x + g.w, s: g.s });
      }
      rows.push({ page: pi + 1, y, tokens });
    }
  });
  return rows;
}

const inCol = (t: Token, [a, b]: readonly [number, number]) => t.end > a && t.end <= b;
const isFormula = (s: string) => /[*×]/.test(s) || /^[\d,.]+\s*원/.test(s) || /%$/.test(s);

type Named = { name: string; funds: Funds };

export function parseBudgetRows(rows: Row[]): BudgetDoc {
  let title = "", dept = "";
  const projects: Project[] = [];
  let policy: Named = { name: "", funds: {} }, unit: Named = { name: "", funds: {} };
  let project: Project | null = null, group: Group | null = null, stat: Stat | null = null;
  let item: Line | null = null, sub: Line | null = null;
  // 마지막으로 만든 노드: 이름 줄바꿈 이어 붙이기, 재원 줄 붙이기에 사용
  let last: { node: Named; row: number; endX: number } | null = null;
  let pendingLine: Line | null = null; // 이름만 있고 금액이 다음 줄에 나오는 항목

  rows.forEach((row, ri) => {
    const text = row.tokens.map((t) => t.s).join(" ");
    if (row.y >= HEADER_Y) {
      if (!title && /\d{4}년도/.test(text)) title = text.replace(/\s+/g, " ").trim();
      const m = text.match(/^부\s*서\s*:\s*(.+)$/);
      if (m && !dept) dept = m[1].trim();
      return;
    }
    if (/^-\s*\d+\s*-$/.test(text.trim())) return; // 쪽 번호

    const nameToks = row.tokens.filter((t) => t.end <= COL.fundLabel[0] + 2);
    const fundTok = row.tokens.find((t) => inCol(t, COL.fundLabel) && FUND_LABELS.includes(t.s.trim()));
    const pick = (c: readonly [number, number]) => { const t = row.tokens.find((t) => inCol(t, c) && num(t.s) !== null); return t ? num(t.s) : null; };
    const cur = pick(COL.cur), prev = pick(COL.prev), diff = pick(COL.diff);

    // 재원 줄: "국   43,000" → 바로 앞 노드의 재원
    if (fundTok && cur !== null && nameToks.length === 0) {
      if (last) last.node.funds[fundTok.s.trim() as FundKey] = cur;
      return;
    }

    // 산식은 이름 열 오른쪽에 붙어 나온다 (이름은 x≈110 이전에서 시작)
    const formulaTok = nameToks.find((t) => t.x > 110 && isFormula(t.s));
    const labelToks = nameToks.filter((t) => t !== formulaTok);
    const label = labelToks.map((t) => t.s).join(" ").trim();
    const x = labelToks[0]?.x ?? 999;
    const endX = labelToks.length ? labelToks[labelToks.length - 1].end : 0;
    const formula = formulaTok ? formulaTok.s.trim() : null;

    // 이름 없이 산식/금액만 있는 줄 → 바로 앞 금액 없는 항목의 값
    if (!label) {
      if (pendingLine) {
        if (formula) pendingLine.formula = formula;
        if (cur !== null) { pendingLine.amount = cur; pendingLine = null; }
      }
      return;
    }

    const codeM = label.match(/^(\d{2,3})\s+(.+)$/);
    const isMarker = /^[○―·ㆍ]/.test(label);

    // 이름이 두 줄로 나뉜 경우 → 바로 앞 노드 이름에 이어 붙임
    //  - ○·― 항목의 둘째 줄은 x≈98 이후에서 시작하고, 산식·금액이 함께 나올 수 있다
    //  - 세부사업 이름의 둘째 줄은 x≈71에서 시작하고 금액이 없다
    const isItemWrap = !isMarker && !codeM && last && x > LEVEL_X.project + 10;
    const isNameWrap = !isMarker && !codeM && last && cur === null && ri - last.row <= 2 && x >= LEVEL_X.project - 2;
    if (last && (isItemWrap || isNameWrap)) {
      last.node.name += (last.endX < WRAP_X ? " " : "") + label;
      last.row = ri; last.endX = endX;
      if (pendingLine) {
        if (formula) pendingLine.formula = formula;
        if (cur !== null) { pendingLine.amount = cur; pendingLine = null; }
      }
      return;
    }

    if (codeM && x >= 78 && x < 90) {
      const code = codeM[1], name = codeM[2].trim();
      if (code.length === 3) {
        group = { code, name, cur: cur ?? 0, prev, diff, funds: {}, stats: [] };
        project?.groups.push(group);
        stat = null;
        last = { node: group, row: ri, endX };
      } else {
        stat = { code, name, cur: cur ?? 0, prev, diff, funds: {}, lines: [] };
        group?.stats.push(stat);
        last = { node: stat, row: ri, endX };
      }
      item = sub = null; pendingLine = null;
      return;
    }

    if (isMarker && stat) {
      const mark = label[0];
      const line: Line = { name: label.slice(1).trim(), formula, amount: cur, funds: {}, children: [] };
      if (mark === "○") { stat.lines.push(line); item = line; sub = null; }
      else if (mark === "―") { (item ? item.children : stat.lines).push(line); sub = line; }
      else (sub ?? item ?? { children: stat.lines }).children.push(line);
      pendingLine = cur === null ? line : null;
      last = { node: line, row: ri, endX };
      return;
    }

    // 부서·정책·단위·세부사업 (금액이 같은 줄에 있음)
    if (cur !== null) {
      const lv = nearestLevel(x);
      group = stat = null; item = sub = null; pendingLine = null;
      if (lv === "project") {
        project = { policy: policy.name, unit: unit.name, name: label, cur, prev, diff, funds: {}, groups: [], page: row.page };
        projects.push(project);
        last = { node: project, row: ri, endX };
        return;
      }
      project = null;
      // 정책·단위 재원은 쓰지 않지만, 이름이 두 줄일 때 이어 붙일 수 있게 노드로 둔다
      const node: Named = { name: label, funds: {} };
      if (lv === "policy") policy = node;
      if (lv === "unit") unit = node;
      if (lv === "dept" && !dept) dept = label;
      last = { node, row: ri, endX };
    }
  });

  const year = title.match(/(\d{4})년도/)?.[1];
  return { title, year: year ? Number(year) : null, dept, projects };
}

function nearestLevel(x: number): keyof typeof LEVEL_X {
  let best: keyof typeof LEVEL_X = "project", bd = Infinity;
  for (const [k, v] of Object.entries(LEVEL_X) as [keyof typeof LEVEL_X, number][]) {
    if (Math.abs(v - x) < bd) { bd = Math.abs(v - x); best = k; }
  }
  return best;
}

/** 재원 줄이 없는 세부사업은 군비 100% */
export const projectFunds = (p: Project): Funds => (Object.keys(p.funds).length ? p.funds : { 군: p.cur });

/** 합계 검증: 세부사업=편성목 합, 편성목=통계목 합, 통계목=○ 항목 합, 재원 합 */
export function validateProject(p: Project): string[] {
  const out: string[] = [];
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const g = sum(p.groups.map((x) => x.cur));
  if (p.groups.length && g !== p.cur) out.push(`편성목 합계 ${g.toLocaleString()} ≠ 세부사업 ${p.cur.toLocaleString()}천원`);
  for (const gr of p.groups) {
    const s = sum(gr.stats.map((x) => x.cur));
    if (gr.stats.length && s !== gr.cur) out.push(`${gr.name}: 통계목 합계 ${s.toLocaleString()} ≠ ${gr.cur.toLocaleString()}천원`);
    for (const st of gr.stats) {
      if (!st.lines.length) continue;
      const l = sum(st.lines.map((x) => x.amount ?? sum(x.children.map((c) => c.amount ?? 0))));
      if (l !== st.cur) out.push(`${st.name}: 산출 항목 합계 ${l.toLocaleString()} ≠ ${st.cur.toLocaleString()}천원`);
    }
  }
  const f = sum(Object.values(projectFunds(p)).map((v) => v ?? 0));
  if (f !== p.cur) out.push(`재원 합계 ${f.toLocaleString()} ≠ 세부사업 ${p.cur.toLocaleString()}천원`);
  return out;
}
