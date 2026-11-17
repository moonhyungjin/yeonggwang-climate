import ExcelJS from "exceljs";
import path from "path";
import type { Obs } from "@/lib/kma";

// 엑셀 양식(templates/*.xlsx) 구조
//  - 시트: "1월" ~ "12월"
//  - 2행: "년도 | 1987년 | 1988년 | ... | 마지막 연도 | 평년·기간평균 등 통계 열"
//  - 3~33행: 1~31일 (일 d → d+2행). 그 아래 월계/월평균/강수일수 행은 시트마다 위치가 달라 건드리지 않는다
export const TEMPLATES = {
  temp: { file: "temp.xlsx", title: "평균기온(87~)" },
  rain: { file: "rain.xlsx", title: "강수량(87~)" },
  sunshine: { file: "sunshine.xlsx", title: "일조시수(87~)" },
} as const;
export type TemplateKind = keyof typeof TEMPLATES;

const HEADER_ROW = 2;
const FIRST_DAY_ROW = 3; // 1일

const colLetter = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const colNumber = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// 셀 참조(시트 접두어·범위 포함). 함수 이름(LOG10( 등)은 뒤에 '('가 와서 제외된다
const REF = /(?<![A-Za-z0-9_.'!])((?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9_(])/g;

/** 수식 안의 참조 중 조건에 맞는 열 번호를 바꾼다 */
function mapRefs(formula: string, ownSheet: string, target: string, map: (col: number) => number) {
  return formula.replace(REF, (m, pre, quoted, bare, d1, c1, d2, r1, d3, c2, d4, r2) => {
    const sheet = pre ? (quoted ?? bare).replace(/''/g, "'") : ownSheet;
    if (sheet !== target) return m;
    const a = `${d1}${colLetter(map(colNumber(c1)))}${d2}${r1}`;
    const b = c2 ? `:${d3}${colLetter(map(colNumber(c2)))}${d4}${r2}` : "";
    return `${pre ?? ""}${a}${b}`;
  });
}

const isFormula = (c: ExcelJS.Cell) => c.type === ExcelJS.ValueType.Formula;

/** 공유 수식을 칸별 일반 수식으로 펼친다 (열을 옮겨도 깨지지 않게) */
function flattenSharedFormulas(wb: ExcelJS.Workbook) {
  for (const ws of wb.worksheets) {
    const fixes: [ExcelJS.Cell, string][] = [];
    ws.eachRow((row) => row.eachCell((c) => { if (isFormula(c)) fixes.push([c, c.formula]); }));
    for (const [c, f] of fixes) c.value = { formula: f } as ExcelJS.CellFormulaValue;
  }
}

function yearColumns(ws: ExcelJS.Worksheet) {
  const years = new Map<number, number>();
  ws.getRow(HEADER_ROW).eachCell((c, col) => {
    const m = String(c.value ?? "").trim().match(/^(\d{4})년$/);
    if (m) years.set(Number(m[1]), col);
  });
  return years;
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** 마지막 연도 열 바로 뒤에 새 연도 열을 끼워 넣는다. 통계 열은 오른쪽으로 밀리고 수식 참조도 따라간다 */
function insertYearColumn(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, year: number, lastCol: number) {
  const ins = lastCol + 1;
  const shift = (col: number) => (col >= ins ? col + 1 : col);

  // 1) 모든 시트의 수식에서 이 시트의 ins 이후 열 참조를 한 칸 민다
  for (const s of wb.worksheets)
    s.eachRow((row) => row.eachCell((c) => {
      if (!isFormula(c)) return;
      const f = mapRefs(c.formula, s.name, ws.name, shift);
      if (f !== c.formula) c.value = { formula: f } as ExcelJS.CellFormulaValue;
    }));

  // 2) ins 이후 칸을 오른쪽으로 한 칸씩 옮긴다 (값·서식·메모)
  const maxCol = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row) => {
    for (let c = maxCol; c >= ins; c--) {
      const src = row.getCell(c), dst = row.getCell(c + 1);
      dst.value = src.value;
      dst.style = clone(src.style);
      dst.note = src.note as any;
      src.value = null;
      src.note = undefined as any;
    }
  });
  for (let c = maxCol; c >= ins; c--) ws.getColumn(c + 1).width = ws.getColumn(c).width;

  // 3) 새 열: 서식·너비는 직전 연도 열을 따르고, 그 열의 수식(월계·월평균 등)은 새 열 기준으로 복사한다
  ws.getColumn(ins).width = ws.getColumn(lastCol).width;
  ws.eachRow({ includeEmpty: true }, (row) => {
    const src = row.getCell(lastCol), dst = row.getCell(ins);
    dst.style = clone(src.style);
    dst.value = isFormula(src)
      ? ({ formula: mapRefs(src.formula, ws.name, ws.name, (col) => (col === lastCol ? ins : col)) } as ExcelJS.CellFormulaValue)
      : null;
  });
  ws.getRow(HEADER_ROW).getCell(ins).value = `${year}년`;
  return ins;
}

/** 해당 연도 열 번호. 없으면 바로 앞 연도 열 뒤에 (중간에 빠진 연도도 포함해) 순서대로 만든다 */
function ensureYearColumn(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, year: number) {
  let years = yearColumns(ws);
  if (years.has(year)) return years.get(year)!;
  const prev = Math.max(...[...years.keys()].filter((y) => y < year));
  if (!Number.isFinite(prev)) throw new Error(`${ws.name} 시트에 ${year}년 열을 만들 위치가 없습니다.`);
  for (let y = prev + 1; y <= year; y++) {
    years = yearColumns(ws);
    insertYearColumn(wb, ws, y, years.get(y - 1)!);
  }
  return yearColumns(ws).get(year)!;
}

/** 엑셀 칸에 넣을 값. undefined면 기존 칸을 건드리지 않는다 */
function cellValue(kind: TemplateKind, o: Obs | undefined): number | null | undefined {
  if (!o) return undefined;
  if (kind === "temp") return o.temp ?? undefined;
  if (kind === "sunshine") return o.sunshine ?? undefined;
  // 강수: 기존 양식은 비가 오지 않은 날을 빈칸으로 둔다 (강수일수 행이 빈칸이 아닌 칸을 센다)
  if (o.rain === null) return undefined;
  return o.rain > 0 ? o.rain : null;
}

export async function fillTemplate(kind: TemplateKind, obs: Map<string, Obs>, dates: string[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(process.cwd(), "templates", TEMPLATES[kind].file));
  flattenSharedFormulas(wb);

  let written = 0;
  for (const date of dates) {
    const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
    const v = cellValue(kind, obs.get(date));
    if (v === undefined) continue;
    const ws = wb.getWorksheet(`${m}월`);
    if (!ws) throw new Error(`${m}월 시트를 찾을 수 없습니다.`);
    const col = ensureYearColumn(wb, ws, y);
    ws.getRow(FIRST_DAY_ROW + d - 1).getCell(col).value = v;
    written++;
  }

  // 수식 결과는 엑셀을 열 때 다시 계산
  wb.calcProperties.fullCalcOnLoad = true;
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), written };
}
