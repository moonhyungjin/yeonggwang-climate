// 해마다 바뀌는 값 다루기.
// 사업기간·전년도 재원별 금액·중기재정계획·※ 비고는 그 해 예산에만 맞는다. 다른 연도 PDF에 작년 값이 그대로 들어가면
// 틀린 문서가 되므로, 저장 정보의 연도(dataYear)가 문서 연도와 다르면 이 값들을 비우고 작년 값은 참고로만 보여 준다.
import type { MasterInfo, YearlyValues } from "./types";

export const MID_PLAN = "중기재정계획" as const;

/** 저장 정보가 몇 년도 예산 것인지. 연도가 없던 예전 저장분은 사업기간("2027. 1월~")이나 중기재정계획 날짜로 추정 */
export function infoYear(m: MasterInfo): number | null {
  if (m.dataYear) return m.dataYear;
  const p = m.period?.match(/^\s*(\d{4})\s*[.년]/);
  if (p) return +p[1];
  const mid = m.prereq?.[MID_PLAN]?.match(/^\s*(\d{4})/); // 2026.10. 중기재정계획 → 2027년 예산
  if (mid) return +mid[1] + 1;
  return null;
}

export type YearView = {
  m: MasterInfo | null; // 이번 문서 연도에 써도 되는 값만 남긴 정보
  stale: YearlyValues | null; // 연도가 달라 비운 작년 값 (참고용)
  reqStale: boolean; // ▶(요구) 문구가 다른 연도 것이라 확인 필요
};

/** 사전절차 값 중 그 해에만 맞는 것: 날짜("2026.11.09.")와 중기재정계획 */
const isYearlyPrereq = (k: string, val: string | undefined) => k === MID_PLAN || /^\s*\d{4}\s*\./.test(val ?? "");
const yearlyPrereq = (m: MasterInfo) =>
  Object.fromEntries(Object.entries(m.prereq ?? {}).filter(([k, val]) => val && isYearlyPrereq(k, val))) as MasterInfo["prereq"];
const yearlyOf = (m: MasterInfo, year: number): YearlyValues => ({ year, period: m.period, prevFunds: m.prevFunds ?? {}, prereq: yearlyPrereq(m), notes: m.notes });
const hasYearly = (v: YearlyValues) => !!(v.period || v.notes || Object.values(v.prevFunds).some(Boolean) || Object.values(v.prereq).some(Boolean));

export function forYear(m: MasterInfo | null, year: number | null): YearView {
  if (!m || !year) return { m, stale: null, reqStale: false };
  const y = infoYear(m);
  const ry = m.reqYear ?? y;
  const reqStale = ry !== null && ry !== year && Object.values(m.requests ?? {}).some(Boolean);
  if (y === null || y === year) {
    // 같은 연도: 이전에 비워 둔 작년 값이 있으면 참고로만
    const stale = m.archive && m.archive.year !== year && hasYearly(m.archive) ? m.archive : null;
    return { m, stale, reqStale };
  }
  const old = yearlyOf(m, y);
  return {
    // 비운 사전절차 칸은 ""(입력 필요)로 남긴다. 값이 없는(undefined) 칸만 "비대상"으로 보기 때문
    m: { ...m, period: "", prevFunds: {}, notes: "", prereq: { ...m.prereq, ...Object.fromEntries(Object.keys(yearlyPrereq(m)).map((k) => [k, ""])), [MID_PLAN]: "" } },
    stale: hasYearly(old) ? old : null,
    reqStale,
  };
}

/** 입력 화면에서 고친 값 저장: 연도가 바뀌었으면 작년 값은 archive로 옮기고 이번 연도 값으로 시작 */
export function applyEdit(raw: MasterInfo, patch: Partial<MasterInfo>, year: number | null): MasterInfo {
  const v = forYear(raw, year);
  const base: MasterInfo = { ...v.m! };
  if (year && infoYear(raw) !== null && infoYear(raw) !== year) base.archive = yearlyOf(raw, infoYear(raw)!);
  const next: MasterInfo = { ...base, ...patch, updatedAt: new Date().toISOString() };
  if (year) {
    next.dataYear = year;
    if (patch.requests) next.reqYear = year;
    else if (next.reqYear === undefined) next.reqYear = infoYear(raw) ?? year;
  }
  return next;
}
