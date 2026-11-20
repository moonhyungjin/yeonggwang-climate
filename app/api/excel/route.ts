import { NextRequest, NextResponse } from "next/server";
import { fetchObs } from "@/lib/kma";
import { fillTemplate, TEMPLATES, type TemplateKind } from "@/lib/excel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // 여러 해를 나눠 받고 재시도까지 하므로 넉넉하게

const MAX_DAYS = 3660; // 엑셀 채우기는 최대 10년

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

export async function GET(req: NextRequest) {
  try {
    const kind = req.nextUrl.searchParams.get("type") as TemplateKind;
    const start = req.nextUrl.searchParams.get("start") || "";
    const end = req.nextUrl.searchParams.get("end") || "";
    if (!(kind in TEMPLATES)) return NextResponse.json({ error: "양식 종류가 올바르지 않습니다." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
      return NextResponse.json({ error: "시작일과 종료일을 올바르게 선택해 주세요." }, { status: 400 });
    if (start < "1987-01-01") return NextResponse.json({ error: "엑셀 양식은 1987년부터입니다." }, { status: 400 });

    const dates = dateRange(start, end);
    if (dates.length > MAX_DAYS)
      return NextResponse.json({ error: "엑셀은 한 번에 최대 10년까지 채울 수 있습니다." }, { status: 400 });

    const obs = await fetchObs(start, end);
    const { buffer } = await fillTemplate(kind, obs, dates);
    const name = `${TEMPLATES[kind].title}_${start}_${end}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="climate.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "엑셀 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
