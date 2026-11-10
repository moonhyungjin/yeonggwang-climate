import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://apihub.kma.go.kr/api/typ01/url/";
const STATION = "252"; // 영광 ASOS
const BASELINE = "2021"; // 1991~2020 평년 (영광은 이전 평년값이 제공되지 않음)

type Obs = { temp: number | null; rain: number | null; sunshine: number | null };

async function kma(path: string, params: Record<string, string>) {
  const key = process.env.KMA_API_KEY;
  if (!key) throw new Error("서버 환경변수 KMA_API_KEY가 설정되지 않았습니다. .env.local에 API 키를 입력해 주세요.");
  const u = new URL(BASE + path);
  Object.entries({ ...params, help: "0", authKey: key }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { cache: "no-store" });
  const body = await res.text();
  // 오류는 JSON({"result":{status,message}})으로 온다
  if (!res.ok || body.trimStart().startsWith("{")) {
    let msg = body.slice(0, 200);
    try { msg = JSON.parse(body).result?.message ?? msg; } catch {}
    throw new Error(`기상청 API 오류 (${path}, ${res.status}): ${msg}`);
  }
  return body;
}

const dataLines = (raw: string) =>
  raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

const num = (s: string | undefined) => {
  const n = Number(s);
  return s !== undefined && s !== "" && Number.isFinite(n) ? n : null;
};

// kma_sfcdd3: 공백 구분, 고정 컬럼 순서 (0: YYMMDD, 10: TA_AVG, 32: SS_DAY, 38: RN_DAY)
// 결측: 기온 -99.0, 일조 -9.0 / 강수 -9.0 은 "강수 없음"
function parseObs(raw: string) {
  const map = new Map<string, Obs>();
  for (const line of dataLines(raw)) {
    const c = line.split(/\s+/);
    if (!/^\d{8}$/.test(c[0])) continue;
    const date = `${c[0].slice(0, 4)}-${c[0].slice(4, 6)}-${c[0].slice(6, 8)}`;
    const ta = num(c[10]), ss = num(c[32]), rn = num(c[38]);
    const temp = ta !== null && ta > -50 ? ta : null;
    const sunshine = ss !== null && ss >= 0 ? ss : null;
    // 기온·일조가 모두 결측이면 장비 결측일로 보고 강수도 결측 처리
    const rowMissing = temp === null && sunshine === null;
    const rain = rn !== null && rn >= 0 ? rn : rowMissing ? null : 0;
    map.set(date, { temp, rain, sunshine });
  }
  return map;
}

// sfc_norm1: CSV  "ST,STN,MM,DD,TA,TA_MAX,TA_MIN,RN,EV,WS,HM,PV,SS,..."  결측 -99.9
function parseNormal(raw: string) {
  const map = new Map<string, Obs>();
  const ok = (n: number | null) => (n !== null && n > -90 ? n : null);
  for (const line of dataLines(raw)) {
    const c = line.split(",").map((x) => x.trim());
    const mm = num(c[2]), dd = num(c[3]);
    if (mm === null || dd === null || dd > 31) continue;
    const key = `${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    map.set(key, { temp: ok(num(c[4])), rain: ok(num(c[7])), sunshine: ok(num(c[12])) });
  }
  return map;
}

// 시간대 영향 없이 UTC 기준으로 날짜 나열
function dateRange(start: string, end: string) {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const ymd = (s: string) => s.replaceAll("-", "");
const valid = (a: (number | null)[]) => a.filter((x): x is number => x !== null);
const avg = (a: (number | null)[]) => { const v = valid(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const sum = (a: (number | null)[]) => { const v = valid(a); return v.length ? v.reduce((s, x) => s + x, 0) : null; };

export async function GET(req: NextRequest) {
  try {
    const start = req.nextUrl.searchParams.get("start") || "";
    const end = req.nextUrl.searchParams.get("end") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
      return NextResponse.json({ error: "시작일과 종료일을 올바르게 선택해 주세요." }, { status: 400 });

    const dates = dateRange(start, end);
    if (dates.length > 366)
      return NextResponse.json({ error: "한 번에 최대 366일까지만 조회할 수 있습니다." }, { status: 400 });

    // 평년값은 1년치를 한 번에 받아 MM-DD로 매칭 (해를 넘기는 기간도 처리됨)
    const [obsRaw, normRaw] = await Promise.all([
      kma("kma_sfcdd3.php", { stn: STATION, tm1: ymd(start), tm2: ymd(end) }),
      kma("sfc_norm1.php", { stn: STATION, norm: "D", tmst: BASELINE, MM1: "1", DD1: "1", MM2: "12", DD2: "31" }),
    ]);
    const obs = parseObs(obsRaw);
    const norm = parseNormal(normRaw);

    const days = dates.map((date) => {
      const o = obs.get(date), n = norm.get(date.slice(5));
      return {
        date,
        temp: o?.temp ?? null, rain: o?.rain ?? null, sunshine: o?.sunshine ?? null,
        normalTemp: n?.temp ?? null, normalRain: n?.rain ?? null, normalSunshine: n?.sunshine ?? null,
      };
    });

    const missing = {
      temp: days.filter((d) => d.temp === null).length,
      rain: days.filter((d) => d.rain === null).length,
      sunshine: days.filter((d) => d.sunshine === null).length,
    };
    const warnings: string[] = [];
    if (obs.size === 0) warnings.push("해당 기간의 관측 자료가 없습니다. 일자료는 보통 다음 날 이후에 제공됩니다.");
    else if (missing.temp || missing.rain || missing.sunshine)
      warnings.push(
        `관측 결측: 기온 ${missing.temp}일, 강수 ${missing.rain}일, 일조 ${missing.sunshine}일. ` +
        "결측일은 평균·합계에서 제외했으므로 누적값이 평년보다 작게 보일 수 있습니다."
      );
    if (norm.size === 0) warnings.push("평년값을 읽지 못했습니다.");

    return NextResponse.json({
      station: "영광(252)",
      period: { start, end },
      baseline: "1991~2020",
      days,
      summary: {
        temp: avg(days.map((d) => d.temp)), normalTemp: avg(days.map((d) => d.normalTemp)),
        rain: sum(days.map((d) => d.rain)), normalRain: sum(days.map((d) => d.normalRain)),
        sunshine: sum(days.map((d) => d.sunshine)), normalSunshine: sum(days.map((d) => d.normalSunshine)),
      },
      missing,
      warnings,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "데이터 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
