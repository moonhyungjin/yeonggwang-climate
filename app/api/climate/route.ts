import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASE = "https://apihub.kma.go.kr/api/typ01/url/";
const STATION = "252"; // 영광 ASOS
const BASELINE = "2021"; // 1991~2020 평년 (영광은 이전 평년값이 제공되지 않음)

type Obs = { temp: number | null; tempMax: number | null; tempMin: number | null; rain: number | null; sunshine: number | null };

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

// kma_sfcdd3: 공백 구분, 고정 컬럼 순서 (0: YYMMDD, 10: TA_AVG, 11: TA_MAX, 13: TA_MIN, 32: SS_DAY, 38: RN_DAY)
// 결측: 기온 -99.0, 일조 -9.0 / 강수 -9.0 은 "강수 없음"
function parseObs(raw: string) {
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

// sfc_norm1: CSV  "ST,STN,MM,DD,TA,TA_MAX,TA_MIN,RN,EV,WS,HM,PV,SS,..."  결측 -99.9
function parseNormal(raw: string) {
  const map = new Map<string, Obs>();
  const ok = (n: number | null) => (n !== null && n > -90 ? n : null);
  for (const line of dataLines(raw)) {
    const c = line.split(",").map((x) => x.trim());
    const mm = num(c[2]), dd = num(c[3]);
    if (mm === null || dd === null || dd > 31) continue;
    const key = `${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    map.set(key, {
      temp: ok(num(c[4])), tempMax: ok(num(c[5])), tempMin: ok(num(c[6])),
      rain: ok(num(c[7])), sunshine: ok(num(c[12])),
    });
  }
  return map;
}

// sfc_norm1 norm=M: CSV  "ST,STN,MM,TA,...,RD_01,RD_10,..."  RD_01/RD_10 = 0.1mm/1.0mm 이상 강수일수
// 일별·순별 평년값에는 강수일수가 없어 월별 평년값을 쓴다. 컬럼 위치는 헤더 주석에서 찾는다
type RainDayNormal = { rd01: number | null; rd10: number | null };
function parseMonthlyRainDays(raw: string) {
  const header = raw.split(/\r?\n/).find((l) => /^#\s*ST,/.test(l));
  const cols = header ? header.replace(/^#/, "").split(",").map((x) => x.trim()) : [];
  const i01 = cols.indexOf("RD_01"), i10 = cols.indexOf("RD_10"), iMM = cols.indexOf("MM");
  const map = new Map<number, RainDayNormal>();
  if (i01 < 0 || i10 < 0 || iMM < 0) return map;
  const ok = (n: number | null) => (n !== null && n > -90 ? n : null);
  for (const line of dataLines(raw)) {
    const c = line.split(",").map((x) => x.trim());
    const mm = num(c[iMM]);
    if (mm === null || mm < 1 || mm > 12) continue;
    map.set(mm, { rd01: ok(num(c[i01])), rd10: ok(num(c[i10])) });
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

// 기간 중 극값: 같은 값이면 먼저 나온 날짜. normal은 그날의 평년값
function extreme<T extends { date: string }>(days: T[], value: (d: T) => number | null, normal: (d: T) => number | null, pick: "max" | "min") {
  let best: T | null = null;
  for (const d of days) {
    const v = value(d);
    if (v === null) continue;
    const b = best ? value(best)! : null;
    if (b === null || (pick === "max" ? v > b : v < b)) best = d;
  }
  return best ? { value: value(best), date: best.date, normal: normal(best) } : { value: null, date: null, normal: null };
}

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
    const [obsRaw, normRaw, monthRaw] = await Promise.all([
      kma("kma_sfcdd3.php", { stn: STATION, tm1: ymd(start), tm2: ymd(end) }),
      kma("sfc_norm1.php", { stn: STATION, norm: "D", tmst: BASELINE, MM1: "1", DD1: "1", MM2: "12", DD2: "31" }),
      kma("sfc_norm1.php", { stn: STATION, norm: "M", tmst: BASELINE, MM1: "1", DD1: "1", MM2: "12", DD2: "31" }),
    ]);
    const obs = parseObs(obsRaw);
    const norm = parseNormal(normRaw);
    const monthRainDays = parseMonthlyRainDays(monthRaw);

    const days = dates.map((date) => {
      const o = obs.get(date), n = norm.get(date.slice(5));
      return {
        date,
        temp: o?.temp ?? null, tempMax: o?.tempMax ?? null, tempMin: o?.tempMin ?? null,
        rain: o?.rain ?? null, sunshine: o?.sunshine ?? null,
        normalTemp: n?.temp ?? null, normalTempMax: n?.tempMax ?? null, normalTempMin: n?.tempMin ?? null,
        normalRain: n?.rain ?? null, normalSunshine: n?.sunshine ?? null,
      };
    });

    const missing = {
      temp: days.filter((d) => d.temp === null).length,
      tempMax: days.filter((d) => d.tempMax === null).length,
      tempMin: days.filter((d) => d.tempMin === null).length,
      rain: days.filter((d) => d.rain === null).length,
      sunshine: days.filter((d) => d.sunshine === null).length,
    };
    const warnings: string[] = [];
    if (obs.size === 0) warnings.push("해당 기간의 관측 자료가 없습니다. 일자료는 보통 다음 날 이후에 제공됩니다.");
    else if (missing.temp || missing.tempMax || missing.tempMin || missing.rain || missing.sunshine)
      warnings.push(
        `관측 결측: 평균기온 ${missing.temp}일, 최고기온 ${missing.tempMax}일, 최저기온 ${missing.tempMin}일, ` +
        `강수 ${missing.rain}일, 일조 ${missing.sunshine}일. ` +
        "결측일은 평균·합계·극값에서 제외했으므로 누적값이 평년보다 작게 보일 수 있습니다."
      );
    if (norm.size === 0) warnings.push("평년값을 읽지 못했습니다.");

    // 강우일수: 관측은 일강수량 기준(결측일 제외), 평년은 월별 평년 일수 × (기간 내 그 달 일수 / 그 달 전체 일수)
    const rainy = (min: number) => obs.size === 0 ? null : days.filter((d) => d.rain !== null && d.rain >= min).length;
    const normalRainDays = (k: keyof RainDayNormal) => {
      let total = 0;
      for (const d of days) {
        const y = Number(d.date.slice(0, 4)), m = Number(d.date.slice(5, 7));
        const v = monthRainDays.get(m)?.[k];
        if (v === null || v === undefined) return null;
        total += v / new Date(Date.UTC(y, m, 0)).getUTCDate();
      }
      return total;
    };
    if (monthRainDays.size === 0) warnings.push("월별 평년 강수일수를 읽지 못했습니다.");

    return NextResponse.json({
      station: "영광(252)",
      period: { start, end },
      baseline: "1991~2020",
      days,
      summary: {
        temp: avg(days.map((d) => d.temp)), normalTemp: avg(days.map((d) => d.normalTemp)),
        tempMax: extreme(days, (d) => d.tempMax, (d) => d.normalTempMax, "max"),
        tempMin: extreme(days, (d) => d.tempMin, (d) => d.normalTempMin, "min"),
        rain: sum(days.map((d) => d.rain)), normalRain: sum(days.map((d) => d.normalRain)),
        sunshine: sum(days.map((d) => d.sunshine)), normalSunshine: sum(days.map((d) => d.normalSunshine)),
        rainDays01: rainy(0.1), normalRainDays01: normalRainDays("rd01"),
        rainDays10: rainy(1.0), normalRainDays10: normalRainDays("rd10"),
      },
      missing,
      warnings,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "데이터 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
