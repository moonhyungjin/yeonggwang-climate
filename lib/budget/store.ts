// 세부사업별 입력 정보를 이 브라우저(localStorage)에 저장. 서버에는 아무것도 보내지 않는다.
import { similarity } from "./hwpxImport";
import { normName, type MasterInfo } from "./types";

const KEY = "budget-master-v1";
export type MasterStore = Record<string, MasterInfo>; // key: normName(세부사업명)

export function loadStore(): MasterStore {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function saveStore(s: MasterStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

/** 세부사업명으로 저장된 정보 찾기. 정확히 같은 이름이 없으면 비슷한 이름(0.75 이상)을 쓴다 */
export function findMaster(store: MasterStore, name: string): { info: MasterInfo; exact: boolean } | null {
  const k = normName(name);
  if (store[k]) return { info: store[k], exact: true };
  let best: MasterInfo | null = null, bs = 0;
  for (const v of Object.values(store)) {
    const s = similarity(v.name, name);
    if (s > bs) { bs = s; best = v; }
  }
  return best && bs >= 0.75 ? { info: best, exact: false } : null;
}

export function exportJson(store: MasterStore) {
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), projects: store }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `세부사업설명서_입력정보_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseBackup(text: string): MasterStore {
  const j = JSON.parse(text);
  const projects = j?.projects ?? j;
  if (!projects || typeof projects !== "object") throw new Error("백업 파일 형식이 아닙니다.");
  return projects as MasterStore;
}
