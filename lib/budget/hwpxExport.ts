// 세부사업설명서 hwpx 만들기.
// 사용자가 고른 기존 설명서(hwpx)를 서식으로 쓴다: 산출근거가 표(구분/산출내역/소요비용/비고)로 된 첫 사업 블록에서
// 문단·표 XML을 떼어 내 글자 모양·테두리는 그대로 두고 내용만 바꿔 끼운다. (예산 내용은 코드에 넣지 않는다)
// 여기서는 XML 문자열만 다룬다(브라우저/Node 공용). zip 처리는 loaders.ts.
import { calcRows, calcStyleOf, calcTextLines, investRows, overviewItems, reqFor, statChangeText, statsOf, won } from "./derive";
import { PREREQ_KEYS, type MasterInfo, type Project } from "./types";

// ---------- XML 도우미 ----------
type Span = { start: number; end: number };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** xml 안에서 바깥쪽(같은 태그로 중첩되지 않은) hp:<tag> 요소 위치들 */
function elements(xml: string, tag: string, from = 0, to = xml.length): Span[] {
  const re = new RegExp(`<(/?)hp:${tag}(?=[\\s>/])[^>]*?(/?)>`, "g");
  re.lastIndex = from;
  const out: Span[] = [];
  let depth = 0, start = -1, m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && m.index < to) {
    if (m[2] === "/") { if (depth === 0) out.push({ start: m.index, end: re.lastIndex }); continue; }
    if (m[1] === "") { if (depth === 0) start = m.index; depth++; }
    else { depth--; if (depth === 0) out.push({ start, end: re.lastIndex }); }
  }
  return out;
}
const pick = (xml: string, s: Span) => xml.slice(s.start, s.end);

/** 보이는 글자 (표 계산식 필드 제외) */
const textOf = (xml: string) => unesc(xml.replace(/<hp:fieldBegin[\s\S]*?<\/hp:fieldBegin>/g, "").replace(/<\/hp:p>/g, "\n").replace(/<[^>]+>/g, "")).trim();
const flat = (s: string) => s.replace(/\s/g, "");
const stripLayout = (xml: string) => xml.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, ""); // 줄 배치 정보는 한글이 다시 계산

const openTag = (xml: string) => xml.slice(0, xml.indexOf(">") + 1);
const setAttr = (tag: string, name: string, val: string | number) =>
  new RegExp(` ${name}="`).test(tag) ? tag.replace(new RegExp(` ${name}="[^"]*"`), ` ${name}="${val}"`) : tag.replace(/\/?>$/, (e) => ` ${name}="${val}"${e}`);

/** 문단의 run별 글자 모양 ID (글자가 있는 run 먼저) */
function runChars(p: string) {
  const runs = [...p.matchAll(/<hp:run charPrIDRef="(\d+)"(\/>|>([\s\S]*?)<\/hp:run>)/g)];
  const withText = runs.filter((r) => /<hp:t>/.test(r[3] ?? "")).map((r) => r[1]);
  return withText.length ? withText : runs.map((r) => r[1]);
}

/** 문단 새로 만들기: 원래 문단의 <hp:p> 속성을 쓰고 run을 바꾼다 */
function para(pOpen: string, runs: [string, string][]) {
  const body = runs.map(([cp, t]) => (t ? `<hp:run charPrIDRef="${cp}"><hp:t>${esc(t)}</hp:t></hp:run>` : `<hp:run charPrIDRef="${cp}"/>`)).join("");
  return `${pOpen}${body || '<hp:run charPrIDRef="0"/>'}</hp:p>`;
}
/** 글자가 있는 run들: [글자 모양 ID, 글자] */
function textRuns(p: string): [string, string][] {
  return [...p.matchAll(/<hp:run charPrIDRef="(\d+)">([\s\S]*?)<\/hp:run>/g)]
    .map((r) => [r[1], unesc((r[2].match(/<hp:t>[^<]*<\/hp:t>/g) ?? []).map((t) => t.slice(6, -7)).join(""))] as [string, string])
    .filter(([, t]) => t !== "");
}

/** 원래 문단 모양 그대로, 글자만 바꾼 문단.
 *  서식 문단이 "항목명 :"과 값을 다른 글자 모양으로 썼으면 새 글자도 같은 자리에서 나눠 각각의 모양을 유지한다 */
function textPara(tpl: string, text: string) {
  const runs = textRuns(tpl);
  const first = runs[0]?.[0] ?? runChars(tpl)[0] ?? "0";
  if (runs.length >= 2 && runs[1][0] !== first && /[:：]\s*$/.test(runs[0][1])) {
    const m = text.match(/^([^:：]*[:：]\s*)([\s\S]*)$/);
    if (m) return para(openTag(tpl), [[first, m[1]], [runs[1][0], m[2]]]);
  }
  return para(openTag(tpl), [[first, text]]);
}

/** 후보 문단 중 가장 많이 쓰인 모양(문단 모양 + 글자 모양)의 문단. 문서마다 처음 나온 하나가 예외일 수 있어서 */
function mostCommon(cands: (string | undefined)[]): string | undefined {
  const count = new Map<string, { n: number; p: string }>();
  for (const p of cands) {
    if (!p) continue;
    const key = (p.match(/paraPrIDRef="(\d+)"/)?.[1] ?? "") + "|" + textRuns(p).map((r) => r[0]).join(",");
    const c = count.get(key);
    if (c) c.n++; else count.set(key, { n: 1, p });
  }
  return [...count.values()].sort((a, b) => b.n - a.n)[0]?.p;
}

/** 표 칸(tc) 내용 바꾸기. runsOf가 주어지면 첫 문단의 run 모양 목록을 받아 run 배열을 만든다 */
function setCell(tc: string, lines: string[] | ((chars: string[]) => [string, string][])) {
  const sl = tc.match(/<hp:subList[^>]*>/)!;
  const a = sl.index! + sl[0].length, b = tc.lastIndexOf("</hp:subList>");
  const ps = elements(tc, "p", a, b);
  const first = ps.length ? pick(tc, ps[0]) : '<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"/></hp:p>';
  const chars = runChars(first), pOpen = openTag(first);
  const body = typeof lines === "function"
    ? para(pOpen, lines(chars))
    : (lines.length ? lines : [""]).map((l) => para(pOpen, [[chars[0] ?? "0", l]])).join("");
  return tc.slice(0, a) + body + tc.slice(b);
}
const cellAddr = (tc: string) => { const m = tc.match(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"/); return m ? { c: +m[1], r: +m[2] } : { c: -1, r: -1 }; };

/** 표의 행·칸 다루기 */
function rowsOf(tbl: string) { return elements(tbl, "tr", tbl.indexOf(">") + 1).map((s) => pick(tbl, s)); }
function cellsOf(tr: string) { return elements(tr, "tc", tr.indexOf(">") + 1).map((s) => pick(tr, s)); }
function mapCells(tbl: string, fn: (tc: string, r: number, c: number) => string) {
  let out = "", last = 0;
  for (const s of elements(tbl, "tc", tbl.indexOf(">") + 1)) {
    const tc = pick(tbl, s), { r, c } = cellAddr(tc);
    out += tbl.slice(last, s.start) + fn(tc, r, c); last = s.end;
  }
  return out + tbl.slice(last);
}

// ---------- 서식 추출 ----------
export type HwpxTemplate = {
  secHead: string; // <?xml ...><hs:sec ...>
  secPrRun: string; // 첫 문단에 들어가는 구역 설정 run
  typeP: string; titleP: string; orgP: string; blankP: string;
  ovHeadP: string; itemP: string; ovSubP: string | null; preHeadP: string; preP: string; invHeadP: string; invP: string;
  calcHeadP: string | null; // "□ 산출근거" 제목 상자 (상자와 같은 문단에 있으면 null)
  boxP: string; // 산출근거 상자가 든 문단
  box: { tbl: string; statP: string; reqP: string; labelP: string; lineP: string; childP: string | null; holderP: string | null; noteP: string };
  calc: { tbl: string; header: string; sum: string; row: string } | null; // 서식에 표 형식 산출근거가 없으면 null
  year: number | null; // 서식의 예산 연도 (투자계획 머리글)
};

function topParas(xml: string) {
  const secOpen = xml.match(/<hs:sec\b[^>]*>/);
  if (!secOpen) throw new Error("hwpx 본문(section) 형식이 아닙니다.");
  const a = secOpen.index! + secOpen[0].length;
  return { head: xml.slice(0, a), paras: elements(xml, "p", a).map((s) => pick(xml, s)) };
}

const isCalcTable = (x: string) => /산출내역/.test(textOf(x)) && /소요비용/.test(textOf(x));

/** 산출근거 상자(1×1 표) 안의 문단들 */
function boxInner(boxP: string) {
  const span = elements(boxP, "tbl").find((t) => /\(전년도\)/.test(textOf(pick(boxP, t))));
  if (!span) return null;
  const tbl = pick(boxP, span);
  const tc = cellsOf(rowsOf(tbl)[0])[0];
  const sl = tc.match(/<hp:subList[^>]*>/)!;
  return { tbl, paras: elements(tc, "p", sl.index! + sl[0].length, tc.lastIndexOf("</hp:subList>")).map((x) => pick(tc, x)) };
}
const isBox = (p: string) => /\(전년도\)/.test(textOf(p)) && p.includes("<hp:tbl");
const hasCalcTable = (p: string) => !!boxInner(p)?.paras.some((q) => q.includes("<hp:tbl") && isCalcTable(q));
const isLine = (p: string) => /^-\s*\S.*천원/.test(textOf(p)) && !p.includes("<hp:tbl");

export function extractTemplate(sections: string[]): HwpxTemplate {
  const secs = sections.map(topParas);
  const first = secs[0]?.paras[0] ?? "";
  const secPrRun = elements(first, "run").map((x) => pick(first, x)).find((r) => r.includes("<hp:secPr")) ?? "";
  const allBoxes = secs.flatMap((x) => x.paras.filter(isBox));

  // 부분별 글자 모양: 문서 전체에서 그 부분에 가장 많이 쓰인 모양 (사업 하나만 보면 예외 모양이 걸릴 수 있음)
  const inners = allBoxes.flatMap((p) => boxInner(p)?.paras ?? []).filter((p) => !p.includes("<hp:tbl"));
  const tops = secs.flatMap((x) => x.paras).filter((p) => !p.includes("<hp:tbl"));
  const isType = (p: string) => /^<.+>$/.test(textOf(p));
  const has = (re: RegExp) => (p: string) => re.test(textOf(p));
  const common = {
    type: mostCommon(tops.filter((p) => isType(p) && !p.includes("<hp:secPr"))),
    title: mostCommon(tops.map((p, i) => (isType(p) && tops[i + 1] && !/^조\s*직/.test(textOf(tops[i + 1])) ? tops[i + 1] : undefined))),
    item: mostCommon(tops.filter(has(/^○/))),
    ovSub: mostCommon(tops.filter(has(/^-\s*\S/))), // 사업내용 등 여러 줄 항목의 다음 줄
    stat: mostCommon(inners.filter(has(/^○.*\(전년도\)/))),
    req: mostCommon(inners.filter(has(/^▶\s*\(요구\)/))),
    label: mostCommon(inners.filter(has(/^▶\s*\(산출\)\s*$/))),
    line: mostCommon(inners.filter(isLine)),
    child: mostCommon(inners.filter(has(/^[·∙]\s*\S.*천원/))),
    note: mostCommon(inners.filter(has(/^※/))),
  };
  // 표 서식: 문서 전체에서 처음 나오는 4열 표
  const calcBoxP = allBoxes.find(hasCalcTable);
  let calc: HwpxTemplate["calc"] = null, holderP: string | null = null;
  if (calcBoxP) {
    holderP = boxInner(calcBoxP)!.paras.find((q) => q.includes("<hp:tbl") && isCalcTable(q))!;
    const calcTbl = pick(holderP, elements(holderP, "tbl")[0]);
    const rows = rowsOf(calcTbl);
    const sumIdx = rows.findIndex((r) => flat(textOf(cellsOf(r)[0] ?? "")) === "계");
    const si = sumIdx > 0 ? sumIdx : 1;
    if (rows.length >= 3) calc = { tbl: stripLayout(calcTbl), header: stripLayout(rows[0]), sum: stripLayout(rows[si]), row: stripLayout(rows[si + 1] ?? rows[rows.length - 1]) };
  }

  // 사업 블록: 표 형식 산출근거가 있는 블록을 먼저, 없으면 첫 블록
  for (const want of [true, false]) for (const { head, paras } of secs) {
    const boxIdx = paras.findIndex((p) => isBox(p) && (!want || hasCalcTable(p)));
    if (boxIdx < 0) continue;
    let start = boxIdx;
    while (start > 0 && !/^<.+>$/.test(textOf(paras[start]))) start--;
    const block = paras.slice(start, boxIdx + 1);
    const find = (re: RegExp, withTbl?: boolean) => block.find((p) => re.test(flat(textOf(p))) && (withTbl === undefined || withTbl === p.includes("<hp:tbl")));
    const typeP = block[0], titleP = block[1];
    const orgP = find(/^조직[:：]/, true), blankP = block.find((p) => !textOf(p) && !p.includes("<hp:tbl"));
    const ovHeadP = find(/^□사업개요/, false), itemP = find(/^○/, false);
    const preHeadP = find(/^□사전절차/, false), preP = find(/중기재정계획/, true);
    const invHeadP = find(/^□투자계획/, false), invP = find(/증감률/, true);
    if (!orgP || !ovHeadP || !itemP || !preHeadP || !preP || !invHeadP || !invP) continue;
    const boxP = paras[boxIdx];
    // "□ 산출근거" 제목 상자: 상자와 같은 문단에 있으면(표 2개) 따로 넣지 않는다
    const calcHeadP = elements(boxP, "tbl").length > 1 ? null : find(/^□산출근거$/, true) ?? null;

    const { tbl: boxTbl, paras: inner } = boxInner(boxP)!;
    const statP = inner.find((p) => /\(전년도\)/.test(textOf(p)))!;
    const reqP = inner.find((p) => /\(요구\)/.test(textOf(p))) ?? statP;
    const labelP = inner.find((p) => /\(산출\)/.test(textOf(p)) && !p.includes("<hp:tbl")) ?? reqP;
    const noteP = inner.find((p) => /^※/.test(textOf(p)) && !p.includes("<hp:tbl")) ?? reqP;

    const ym = textOf(cellsOf(rowsOf(pick(invP, elements(invP, "tbl")[0]))[0])[1] ?? "").match(/(\d{4})년/);
    return {
      secHead: head, secPrRun,
      typeP: stripLayout(common.type ?? typeP.replace(secPrRun, "")), titleP: stripLayout(common.title ?? titleP), orgP: stripLayout(orgP), blankP: stripLayout(blankP ?? ovHeadP.replace(/<hp:t>[\s\S]*?<\/hp:t>/g, "")),
      ovHeadP: stripLayout(ovHeadP), itemP: stripLayout(common.item ?? itemP), ovSubP: common.ovSub ? stripLayout(common.ovSub) : null, preHeadP: stripLayout(preHeadP), preP: stripLayout(preP), invHeadP: stripLayout(invHeadP), invP: stripLayout(invP),
      calcHeadP: calcHeadP ? stripLayout(calcHeadP) : null, boxP: stripLayout(boxP),
      box: {
        tbl: stripLayout(boxTbl), statP: stripLayout(common.stat ?? statP), reqP: stripLayout(common.req ?? reqP), labelP: stripLayout(common.label ?? labelP),
        lineP: stripLayout(common.line ?? reqP), childP: common.child ? stripLayout(common.child) : null,
        holderP: holderP ? stripLayout(holderP) : null, noteP: stripLayout(common.note ?? noteP),
      },
      calc, year: ym ? +ym[1] : null,
    };
  }
  throw new Error("서식 hwpx에서 세부사업 블록(조직 표·사업개요·사전절차·투자계획·산출근거)을 찾지 못했습니다.");
}

// ---------- 만들기 ----------
/** 문단 첫 글자 앞의 공백 (서식의 들여쓰기 유지) */
const leadOf = (p: string) => unesc(p.match(/<hp:t>([\s\S]*?)<\/hp:t>/)?.[1] ?? "").match(/^\s*/)![0];
const cellH = (tr: string) => +(tr.match(/<hp:cellSz [^>]*height="(\d+)"/)?.[1] ?? 1300);
const setTblHeight = (tbl: string, h: number) => tbl.replace(/(<hp:sz [^>]*height=")\d+/, `$1${h}`);

/** 투자계획 표 */
function investTable(t: HwpxTemplate, p: Project, m: MasterInfo | null, year: number) {
  const rows = investRows(p, m);
  const tbl = pick(t.invP, elements(t.invP, "tbl")[0]);
  const ty = t.year;
  const filled = mapCells(tbl, (tc, r, c) => {
    if (r === 0) {
      if (!ty) return tc;
      return tc.replace(/<hp:t>([\s\S]*?)<\/hp:t>/g, (_, s) => `<hp:t>${s.replace(/(\d{4})년/g, (y: string, n: string) => `${year + (+n - ty)}년`)}</hp:t>`);
    }
    const row = rows[r - 1];
    if (!row || c === 0) return tc;
    const v = c === 1 ? row.a : c === 2 ? row.b : c === 3 ? row.c : null;
    const s = c === 4 ? row.rate : c === 5 ? row.note : v === null ? "" : v === 0 && c === 3 ? "-" : v < 0 ? `△${(-v).toLocaleString()}` : v.toLocaleString();
    return setCell(tc, [c === 4 && row.a !== null && row.b !== null && row.a === row.b ? "-" : s]);
  });
  return t.invP.replace(tbl, filled);
}

/** 산출근거 4열 표 */
function calcTable(t: HwpxTemplate, s: ReturnType<typeof statsOf>[number]) {
  const c = t.calc!;
  const data = calcRows(s);
  const head = openTag(c.tbl), headEnd = c.tbl.indexOf("<hp:tr");
  const pre = c.tbl.slice(head.length, headEnd); // sz, pos, margin
  const withRow = (tr: string, r: number) => tr.replace(/rowAddr="\d+"/g, `rowAddr="${r}"`);
  const sum = cellsOf(c.sum).map((tc, c) => (c === 2 ? setCell(tc, [won(s.cur)]) : c === 0 ? tc : setCell(tc, [""])));
  const sumTr = c.sum.slice(0, c.sum.indexOf("<hp:tc")) + sum.join("") + "</hp:tr>";
  const rowTpl = c.row;
  const rowCells = cellsOf(rowTpl), rowOpen = rowTpl.slice(0, rowTpl.indexOf("<hp:tc"));
  const dataTrs = data.map((d, i) => withRow(rowOpen + rowCells.map((tc, c) => setCell(tc, [[d.name, d.formula, d.amount, d.note][c] ?? ""])).join("") + "</hp:tr>", i + 2));
  const height = cellH(c.header) + cellH(c.sum) + data.length * cellH(rowTpl);
  const tbl = setAttr(head, "rowCnt", data.length + 2) + pre + withRow(c.header, 0) + withRow(sumTr, 1) + dataTrs.join("") + "</hp:tbl>";
  return { xml: setTblHeight(tbl, height), height };
}

/** 산출근거 상자 (통계목별 ○ / ▶요구 / ▶산출 / 표, 끝에 ※) */
function calcBox(t: HwpxTemplate, p: Project, m: MasterInfo | null) {
  const b = t.box;
  const parts: string[] = [];
  const add = (tpl: string, text: string) => { parts.push(textPara(tpl, text)); };
  const lead = (tpl: string) => leadOf(tpl);
  for (const s of statsOf(p)) {
    add(b.statP, `${lead(b.statP)}○ ${s.name} : ${statChangeText(s)}`);
    add(b.reqP, `${lead(b.reqP)}▶ (요구) ${reqFor(m, s.group, s.name, statsOf(p).length)}`);
    add(b.labelP, `${lead(b.labelP)}▶ (산출)`);
    if (!s.lines.length) continue;
    if (calcStyleOf(m, s.name) === "table" && t.calc && b.holderP) {
      const tbl = calcTable(t, s);
      parts.push(`${openTag(b.holderP)}<hp:run charPrIDRef="${runChars(b.holderP)[0] ?? "0"}">${tbl.xml}<hp:t/></hp:run></hp:p>`);
    } else {
      // "- " 줄과 "· " 하위 줄은 서식에서 각자의 모양(들여쓰기·글자)을 쓴다
      for (const l of calcTextLines(s)) {
        const tpl = l.depth && b.childP ? b.childP : b.lineP;
        const extra = l.depth && b.childP ? l.depth - 1 : l.depth;
        add(tpl, lead(tpl) + "  ".repeat(extra) + l.text);
      }
    }
  }
  for (const n of (m?.notes ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) add(b.noteP, n);

  const tc = cellsOf(rowsOf(b.tbl)[0])[0];
  const sl = tc.match(/<hp:subList[^>]*>/)!;
  // 한글은 칸 높이를 '최소 높이'로 쓰고 내용만큼 늘린다. 그래서 상자는 작게 두고 한글이 맞추게 한다.
  // 상자 칸 자신의 크기(cellSz)는 </hp:subList> 뒤에 있다. 안쪽 표의 칸 크기를 건드리지 않도록 뒷부분에서만 바꾼다
  const height = 2000;
  const tail = tc.slice(tc.lastIndexOf("</hp:subList>")).replace(/(<hp:cellSz [^>]*height=")\d+/, `$1${height}`);
  const newTc = tc.slice(0, sl.index! + sl[0].length) + parts.join("") + tail;
  const tbl = setTblHeight(b.tbl.replace(tc, newTc), height);
  return t.boxP.replace(b.tbl, tbl);
}

export type ExportItem = { p: Project; m: MasterInfo | null };

/** section0.xml 본문 만들기 */
export function renderSection(t: HwpxTemplate, items: ExportItem[], year: number) {
  const out: string[] = [];
  items.forEach(({ p, m }, i) => {
    // <단년·반복사업> (사업마다 새 쪽, 첫 문단에는 구역 설정)
    let typeP = textPara(t.typeP, `<${m?.type || "단년·반복사업"}>`);
    typeP = typeP.replace(/<hp:p\b[^>]*>/, (o) => setAttr(o, "pageBreak", i === 0 ? 0 : 1));
    if (i === 0 && t.secPrRun) typeP = typeP.replace(/(<hp:p\b[^>]*>)/, `$1${t.secPrRun}`);
    out.push(typeP, textPara(t.titleP, p.name));

    // 조직·정책·단위·세부 표
    const orgTbl = pick(t.orgP, elements(t.orgP, "tbl")[0]);
    const vals: [RegExp, string][] = [[/^조직/, m?.org ?? ""], [/^정책사업/, p.policy], [/^단위사업/, p.unit], [/^세부사업/, p.name]];
    const org = mapCells(orgTbl, (tc) => {
      const txt = textOf(tc), hit = vals.find(([re]) => re.test(flat(txt)));
      if (!hit) return tc;
      const label = txt.match(/^[^:：]*[:：]\s*/)?.[0] ?? "";
      const runs = [...tc.matchAll(/<hp:run charPrIDRef="(\d+)">\s*<hp:t>([\s\S]*?)<\/hp:t>/g)];
      const labelRun = runs[0] && unesc(runs[0][2]).trim() === label.trim();
      return setCell(tc, (chars) => labelRun && chars[1] ? [[chars[0], unesc(runs[0][2])], [chars[1], hit[1]]] : [[chars[0], label + hit[1]]]);
    });
    out.push(t.orgP.replace(orgTbl, org), t.blankP);

    // □ 사업개요
    out.push(t.ovHeadP);
    const lead = leadOf(t.itemP);
    for (const [k, val] of overviewItems(p, m, year)) {
      const [firstLine, ...rest] = val.split("\n").map((x) => x.trimEnd());
      out.push(textPara(t.itemP, `${lead}○ ${k} : ${firstLine.trim()}`));
      for (const l of rest.filter((x) => x.trim())) out.push(t.ovSubP ? textPara(t.ovSubP, leadOf(t.ovSubP) + l.trim()) : textPara(t.itemP, `${lead}  ${l.trim()}`));
    }
    out.push(t.blankP);

    // □ 사전절차이행여부
    const preTbl = pick(t.preP, elements(t.preP, "tbl")[0]);
    const labels = new Map<string, string>(); // "r,c" → 항목명
    mapCells(preTbl, (tc, r, c) => { labels.set(`${r},${c}`, flat(textOf(tc))); return tc; });
    const pre = mapCells(preTbl, (tc, r, c) => {
      const key = labels.get(`${r},${c - 1}`);
      return key && (PREREQ_KEYS as string[]).includes(key) ? setCell(tc, [m?.prereq?.[key as keyof MasterInfo["prereq"]] ?? (key === "중기재정계획" ? "" : "비대상")]) /* 값이 없으면 비대상. ""는 입력 안 된 칸(연도가 바뀌어 비운 날짜 등)이라 빈칸. 중기재정계획은 기본값 없음 */ : tc;
    });
    out.push(t.preHeadP, t.preP.replace(preTbl, pre), t.blankP);

    // □ 투자계획
    out.push(t.invHeadP, investTable(t, p, m, year));

    // □ 산출근거
    if (t.calcHeadP) out.push(t.calcHeadP);
    out.push(calcBox(t, p, m));
  });
  // 표 id·순서는 문서 안에서 겹치지 않게 새로 매긴다
  let seq = 0;
  const body = out.join("").replace(/<hp:tbl\b[^>]*>/g, (tag) => { seq++; return setAttr(setAttr(tag, "id", 1900000000 + seq), "zOrder", seq); });
  return t.secHead + body + "</hs:sec>";
}

/** 미리보기 텍스트 (Preview/PrvText.txt) */
export function previewText(items: ExportItem[]) {
  return items.map(({ p }) => `<${p.name}>`).join("\r\n").slice(0, 1000);
}
