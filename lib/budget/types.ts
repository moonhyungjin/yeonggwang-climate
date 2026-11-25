// 세출예산사업명세서(PDF) → 세부사업설명서 데이터 모델 (금액 단위: 천원)

export type FundKey = "국" | "균" | "기" | "시" | "군";
export type Funds = Partial<Record<FundKey, number>>;

/** 산출 내역 한 줄 (○ 항목, 그 아래 ― 항목, 다시 그 아래 · 항목) */
export type Line = {
  name: string;
  formula: string | null; // 예: "12,000원*200부"
  amount: number | null;
  funds: Funds;
  children: Line[];
};

/** 통계목 (예: 01 사무관리비) */
export type Stat = { code: string; name: string; cur: number; prev: number | null; diff: number | null; funds: Funds; lines: Line[] };

/** 편성목 (예: 201 일반운영비) */
export type Group = { code: string; name: string; cur: number; prev: number | null; diff: number | null; funds: Funds; stats: Stat[] };

export type Project = {
  policy: string; // 정책사업
  unit: string; // 단위사업
  name: string; // 세부사업
  cur: number;
  prev: number | null;
  diff: number | null;
  funds: Funds;
  groups: Group[];
  page: number;
};

export type BudgetDoc = { title: string; year: number | null; dept: string; projects: Project[] };

/** PDF에 없어서 사람이 입력하는 정보. 세부사업명 기준으로 브라우저에 저장해 해마다 다시 쓴다 */
export type PrereqKey = "중기재정계획" | "투자심사" | "공유재산관리계획" | "정책연구용역" | "지방보조금심의" | "정수물품취득";
export const PREREQ_KEYS: PrereqKey[] = ["중기재정계획", "투자심사", "공유재산관리계획", "정책연구용역", "지방보조금심의", "정수물품취득"];

export type MasterInfo = {
  name: string; // 원래 세부사업명
  type: string; // <단년·반복사업> 등
  org: string; // 조직
  basis: string; // 지원근거
  purpose: string; // 사업목적
  period: string; // 사업기간 (비우면 "YYYY. 1월 ~ 12월")
  content: string; // 사업내용
  target: string; // 지원대상
  supportForm: string; // 지원형태 (비우면 편성목으로 자동 제안)
  subsidyRate: string; // 보조율 (비우면 재원으로 자동 제안)
  prereq: Partial<Record<PrereqKey, string>>;
  requests: Record<string, string>; // 통계목명 → ▶(요구) 문구
  notes: string; // ※ 비고 (감액 사유 등)
  prevFunds: Partial<Record<"국비" | "시비" | "군비" | "기타", string>>; // 전년도 재원별 금액(백만원), PDF에 없음
  calcStyle?: Record<string, "text" | "table">; // 통계목명(공백 제거) → 산출근거 형식. 없으면 글
  // 해마다 바뀌는 값(사업기간·전년도 재원별 금액·사전절차 날짜·※ 비고)이 몇 년도 예산 것인지. 다른 연도 PDF에서는 쓰지 않는다
  dataYear?: number;
  reqYear?: number; // ▶(요구) 문구를 몇 년도 예산용으로 확인했는지
  archive?: YearlyValues; // 연도가 바뀌어 비운 작년 값 (참고용으로만 보여 줌)
  updatedAt: string;
};

/** 해마다 바뀌는 값 묶음 */
export type YearlyValues = { year: number; period: string; prevFunds: MasterInfo["prevFunds"]; prereq: MasterInfo["prereq"]; notes: string }; // prereq: 날짜로 된 사전절차 값만

export const emptyMaster =(name: string): MasterInfo => ({
  name, type: "단년·반복사업", org: "", basis: "", purpose: "", period: "", content: "", target: "",
  supportForm: "", subsidyRate: "", prereq: {}, requests: {}, notes: "", prevFunds: {}, calcStyle: {}, updatedAt: "",
});

/** 이름 비교용: 공백·가운뎃점 등 차이를 무시 */
export const normName = (s: string) => s.replace(/[\s·‧∙ㆍ・]/g, "").replace(/[‐-―]/g, "-");
