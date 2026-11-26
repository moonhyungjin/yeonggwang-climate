const BASE = "https://apihub.kma.go.kr/api/typ01/url/";
export const STATION = "252"; // 영광 ASOS
export const BASELINE = "2021"; // 1991~2020 평년 (영광은 이전 평년값이 제공되지 않음)
const TIMEOUT_MS = 15000; // 기상청이 느린 날은 정상 응답도 5~10초 걸린다. 너무 짧으면 정상 응답을 끊고 다시 받게 된다
const MAX_ATTEMPTS = 3;

export type Obs = { temp: number | null; tempMax: number | null; tempMin: number | null; rain: number | null; sunshine: number | null };

// 평년값처럼 바뀌지 않는 자료는 정상 응답을 서버 메모리에 잠시 둔다 (같은 서버 인스턴스 안에서만, 오류 응답은 저장 안 함)
const memo = new Map<string, { at: number; body: string }>();

export async function kma(path: string, params: Record<string, string>, opts: { cacheSeconds?: number } = {}) {
  const memoKey = path + "?" + new URLSearchParams(params).toString();
  const hit = opts.cacheSeconds ? memo.get(memoKey) : undefined;
  if (hit && Date.now() - hit.at < opts.cacheSeconds! * 1000) return hit.body;
  const key = process.env.KMA_API_KEY;
  if (!key) throw new Error("서버 환경변수 KMA_API_KEY가 설정되지 않았습니다. .env.local에 API 키를 입력해 주세요.");
  const u = new URL(BASE + path);
  Object.entries({ ...params, help: "0", authKey: key }).forEach(([k, v]) => u.searchParams.set(k, v));

  // 기상청 서버가 간헐적으로 30초 넘게 멈추거나 504를 준다.
  // 15초 안에 응답이 없거나 5xx면 다시 시도한다 (최대 3번).
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      lastError = `${TIMEOUT_MS / 1000}초 안에 응답이 없습니다`;
      continue;
    }
    const body = await res.text();
    if (res.status >= 500) {
      lastError = `서버 오류 ${res.status}`;
      continue;
    }
    // 그 밖의 오류(인증·활용신청 등)는 JSON({"result":{status,message}})으로 오며, 재시도해도 같으므로 바로 알린다
    if (!res.ok || body.trimStart().startsWith("{")) {
      let msg = body.slice(0, 200);
      try { msg = JSON.parse(body).result?.message ?? msg; } catch {}
      throw new Error(`기상청 API 오류 (${path}, ${res.status}): ${msg}`);
    }
    if (opts.cacheSeconds) memo.set(memoKey, { at: Date.now(), body });
    return body;
  }
  throw new Error(`기상청 서버가 응답하지 않습니다 (${path}, ${MAX_ATTEMPTS}번 시도: ${lastError}). 잠시 후 다시 조회해 주세요.`);
}

export const dataLines = (raw: string) =>
  raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

export const num = (s: string | undefined) => {
  const n = Number(s);
  return s !== undefined && s !== "" && Number.isFinite(n) ? n : null;
};

// kma_sfcdd3: 공백 구분, 고정 컬럼 순서 (0: YYMMDD, 10: TA_AVG, 11: TA_MAX, 13: TA_MIN, 32: SS_DAY, 38: RN_DAY)
// 결측: 기온 -99.0, 일조 -9.0 / 강수 -9.0 은 "강수 없음"
export function parseObs(raw: string) {
  const map = new Map<string, Obs>();
  for (const line of dataLines(raw)) {
    const c = line.split(/\s+/);
    if (!/^\d{8}$/.test(c[0])) continue;
    const date = `${c[0].slice(0, 4)}-${c[0].slice(4, 6)}-${c[0].slice(6, 8)}`;
    const ta = num(c[10]), tx = num(c[11]), tn = num(c[13]), ss = num(c[32]), rn = num(c[38]);
    const okTemp = (n: number | null) => (n !== null && n > -50 ? n : null);
    const temp = okTemp(ta), tempMax = okTemp(tx), tempMin = okTemp(tn);
    const sunshine = ss !== null && ss >= 0 ? ss : null;
    // 기온·일조가 모두 결측이면 장비 결측일로 보고 강수도 결측 처리
    const rowMissing = temp === null && sunshine === null;
    const rain = rn !== null && rn >= 0 ? rn : rowMissing ? null : 0;
    map.set(date, { temp, tempMax, tempMin, rain, sunshine });
  }
  return map;
}

// 일자료를 연 단위로 나눠 받는다 (긴 기간 조회용)
export async function fetchObs(start: string, end: string) {
  const out = new Map<string, Obs>();
  const y1 = Number(start.slice(0, 4)), y2 = Number(end.slice(0, 4));
  const parts: Promise<string>[] = [];
  for (let y = y1; y <= y2; y++) {
    const s = y === y1 ? start : `${y}-01-01`, e = y === y2 ? end : `${y}-12-31`;
    parts.push(kma("kma_sfcdd3.php", { stn: STATION, tm1: s.replaceAll("-", ""), tm2: e.replaceAll("-", "") }));
  }
  for (const raw of await Promise.all(parts)) parseObs(raw).forEach((v, k) => out.set(k, v));
  return out;
}
