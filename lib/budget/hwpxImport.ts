// 기존 세부사업설명서(hwpx)에서 PDF에 없는 정보(조직·지원근거·사업목적 등)를 세부사업별로 뽑는다.
// hwpx는 zip 안의 Contents/section*.xml 이 본문이다. 여기서는 그 XML 문자열만 받는다(브라우저/Node 공용).
import { emptyMaster, normName, PREREQ_KEYS, type MasterInfo, type PrereqKey } from "./types";

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 문단·표 칸 단위 텍스트 줄. 표 칸 경계는 줄 앞의 "│"로 표시 */
export function sectionXmlToLines(xml: string): string[] {
  const text = xml
    .replace(/<hp:fieldBegin[\s\S]*?<\/hp:fieldBegin>/g, "") // 표 계산식 필드 코드 제거
    .replace(/<\/hp:p>/g, "\n")
    .replace(/<\/hp:tc>/g, "│")
    .replace(/<\/hp:tr>/g, "\n")
    .replace(/<hp:lineBreak\/>/g, "\n")
    .replace(/<hp:tab[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.replace(/[│\s]/g, ""));
}

const clean = (s: string) => s.replace(/^[│\s]+/, "").trim();
const labelOf = (s: string) => s.replace(/\s/g, "");

// 사업개요 항목명 → 필드
const OVERVIEW_FIELDS: [RegExp, keyof MasterInfo | null][] = [
  [/근거$/, "basis"],
  [/^사업목적$/, "purpose"],
  [/^사업기간$/, "period"],
  [/^사업비$/, null], // PDF에서 계산
  [/^사업내용$/, "content"],
  [/^지원대상$/, "target"],
  [/^지원형태$/, "supportForm"],
  [/^보조율$/, "subsidyRate"],
];

export type ImportedProject = MasterInfo & { titleName: string };

export function parseHwpxLines(lines: string[]): ImportedProject[] {
  const anchors: number[] = [];
  lines.forEach((l, i) => { if (/^조\s*직\s*:/.test(clean(l))) anchors.push(i); });
  const out: ImportedProject[] = [];

  anchors.forEach((a, k) => {
    // 블록 시작: 조직 줄 위의 "<단년·반복사업>"과 제목 줄
    let start = a;
    for (let j = a - 1; j >= Math.max(0, a - 3); j--) { start = j; if (/^<.+>$/.test(clean(lines[j]))) break; }
    const nextStart = k + 1 < anchors.length ? anchors[k + 1] - 2 : lines.length;
    const block = lines.slice(start, Math.max(nextStart, a + 1)).map(clean);
    const typeLine = block.find((l) => /^<.+>$/.test(l));
    const orgLine = clean(lines[a]);
    const nameLine = block.find((l) => /세부사업\s*:/.test(l)) ?? "";
    const name = nameLine.replace(/^.*세부사업\s*:\s*/, "").trim();
    const titleIdx = block.findIndex((l) => /^<.+>$/.test(l));
    const titleName = titleIdx >= 0 && block[titleIdx + 1] && !/조\s*직\s*:/.test(block[titleIdx + 1]) ? block[titleIdx + 1] : name;

    // 표의 세부사업 칸이 잘린 경우(예: 괄호 부분 누락)가 있어, 제목 줄이 더 길고 앞부분이 같으면 제목을 쓴다
    const fullName = name && normName(titleName).startsWith(normName(name)) && titleName.length > name.length ? titleName : name || titleName;
    const m: ImportedProject = { ...emptyMaster(fullName), titleName };
    m.type = typeLine ? typeLine.slice(1, -1) : "단년·반복사업";
    m.org = orgLine.replace(/^조\s*직\s*:\s*/, "").trim();

    // □ 사업개요
    const iOv = block.findIndex((l) => /^□\s*사업\s*개요/.test(l));
    const iPre = block.findIndex((l) => /^□\s*사전절차/.test(l));
    const iInv = block.findIndex((l) => /^□\s*투자계획/.test(l));
    const iCalc = block.findIndex((l) => /^□\s*산출근거/.test(l));
    if (iOv >= 0) {
      let field: keyof MasterInfo | null | "extra" = null;
      const extra: string[] = [];
      for (const l of block.slice(iOv + 1, iPre > iOv ? iPre : iInv > iOv ? iInv : block.length)) {
        // "○ 항목 : 값" 또는 값이 다음 줄부터 나오는 "○ 항목"
        const mm = l.match(/^[○▶]\s*([^:：]+?)\s*(?:[:：]\s*(.*))?$/);
        const hit = mm && OVERVIEW_FIELDS.find(([re]) => re.test(labelOf(mm[1])));
        if (mm && hit) {
          field = hit[1];
          if (field) (m as any)[field] = (mm[2] ?? "").trim();
        } else if (mm) {
          field = "extra"; extra.push(l);
        } else if (field === "extra") extra.push(l);
        else if (field) (m as any)[field] = ((m as any)[field] ? (m as any)[field] + "\n" : "") + l;
      }
      if (extra.length) m.content = [m.content, ...extra].filter(Boolean).join("\n");
    }

    // □ 사전절차이행여부: 항목명 다음 칸이 값 (빈칸이면 다음이 바로 항목명)
    if (iPre >= 0) {
      const toks = block.slice(iPre + 1, iInv > iPre ? iInv : iPre + 20);
      const isKey = (t: string) => PREREQ_KEYS.some((k) => labelOf(t) === k);
      for (const key of PREREQ_KEYS) {
        const i = toks.findIndex((t) => labelOf(t) === key);
        if (i >= 0 && toks[i + 1] && !isKey(toks[i + 1]) && !toks[i + 1].startsWith("□")) m.prereq[key as PrereqKey] = toks[i + 1];
      }
    }

    // □ 투자계획: 전년도 재원별 금액 (행 이름 다음 칸들: a, b, c, 증감률, 비고)
    if (iInv >= 0) {
      const rows = lines.slice(start + iInv + 1, start + (iCalc > iInv ? iCalc : iInv + 40));
      rows.forEach((raw, i) => {
        const t = clean(raw);
        if (raw.startsWith("│")) return;
        const key = (["국비", "시비", "군비", "기타"] as const).find((k) => labelOf(t) === k);
        if (!key) return;
        const cells: string[] = [];
        for (let j = i + 1; j < rows.length && rows[j].startsWith("│"); j++) cells.push(clean(rows[j]));
        if (cells[1]) m.prevFunds[key] = cells[1];
      });
    }

    // □ 산출근거: 통계목별 ▶ (요구) 문구, ※ 비고
    if (iCalc >= 0) {
      let stat: string | null = null, inReq = false;
      const notes: string[] = [];
      const calcLines = block.slice(iCalc + 1);
      for (const [i, l] of calcLines.entries()) {
        const sm = l.match(/^○\s*(.+?)\s*[:：]\s*\(전년도\)/);
        if (sm) { stat = labelOf(sm[1]); inReq = false; continue; }
        // 산출이 표(구분 │ 산출내역 …)로 되어 있던 통계목은 표 형식을 기억
        if (stat && labelOf(l) === "구분" && /^산출내역/.test(labelOf(calcLines[i + 1] ?? "").replace(/^│/, ""))) {
          m.calcStyle = { ...m.calcStyle, [stat]: "table" }; inReq = false; continue;
        }
        const rm = l.match(/^▶\s*\(요구\)\s*(.*)$/);
        if (rm && stat) { m.requests[stat] = rm[1].trim(); inReq = true; continue; }
        if (/^▶/.test(l) || /^□/.test(l)) { inReq = false; continue; }
        if (/^※/.test(l)) { notes.push(l); inReq = false; continue; }
        if (inReq && stat && !/^[-·]/.test(l)) m.requests[stat] += " " + l;
      }
      m.notes = notes.join("\n");
    }
    m.updatedAt = new Date().toISOString();
    out.push(m);
  });
  return out;
}

/** 이름 유사도 (글자 2개씩 묶어 겹치는 비율, 0~1) */
export function similarity(a: string, b: string) {
  const A = normName(a), B = normName(b);
  if (A === B) return 1;
  if (A.length > 4 && B.length > 4 && (A.startsWith(B) || B.startsWith(A))) return 0.95;
  const grams = (s: string) => { const g = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1); } return g; };
  const ga = grams(A), gb = grams(B);
  let inter = 0;
  ga.forEach((v, k) => { inter += Math.min(v, gb.get(k) ?? 0); });
  return (2 * inter) / Math.max(1, A.length - 1 + B.length - 1);
}
