// 계약서 도우미: 업체 정보와 자주 쓰는 기본값을 이 브라우저(localStorage)에 저장. 서버로 보내지 않는다.
export type Company = {
  bizNo: string; company: string; ceo: string; address: string; phone: string; entity: "개인" | "법인";
  industries: string[]; // 사업자등록증의 업태(종목) 전체
  selected: string[]; // 계약서 업종(등록) 칸에 넣는 것
  updatedAt: string;
};
export type Defaults = { kind: "공사" | "물품" | "용역"; delayRate: string; etc: string; workType: string; defectRate: number; placePrefix: string };

const C_KEY = "contract-companies-v1", D_KEY = "contract-defaults-v1";
const load = <T,>(k: string, d: T): T => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || "{}") }; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const loadCompanies = () => load<Record<string, Company>>(C_KEY, {});
export const saveCompanies = (v: Record<string, Company>) => save(C_KEY, v);

export const DEFAULTS: Defaults = { kind: "용역", delayRate: "", etc: "", workType: "", defectRate: 2, placePrefix: "" };
export const loadDefaults = () => load<Defaults>(D_KEY, DEFAULTS);
export const saveDefaults = (v: Defaults) => save(D_KEY, v);
export const hasDefaults = () => { try { return !!localStorage.getItem(D_KEY); } catch { return false; } };
