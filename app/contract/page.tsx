"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Building2, FileDown, FileText, FileUp, Info, RefreshCw } from "lucide-react";
import Txt from "@/app/components/Txt";
import { buildRules, dotDate, moneyText, type ContractData, type TemplateInfo } from "@/lib/contract/fill";
import { contractTerm, parseBizCert, parseDraft } from "@/lib/contract/parsePdfs";
import { DEFAULTS, hasDefaults, loadCompanies, loadDefaults, saveCompanies, saveDefaults, type Company, type Defaults } from "@/lib/contract/store";
import { loadTemplate, saveTemplate } from "@/lib/budget/templateStore";

const TPL_KEY = "contract";

type Form = {
  name: string; amount: string; payAmount: string; bond: string; delayRate: string; term: string; place: string; etc: string;
  kind: ContractData["kind"]; contractDate: string; orderDate: string; doneDate: string;
  company: string; ceo: string; address: string; bizNo: string; phone: string; entity: ContractData["entity"];
  industries: string[]; selected: string[];
  workType: string; defectRate: string; defect: string;
  auto: { payAmount: boolean; bond: boolean; defect: boolean }; // 금액에서 자동 계산 중인지
};

const EMPTY: Form = {
  name: "", amount: "", payAmount: "", bond: "", delayRate: "", term: "", place: "", etc: "", kind: "용역",
  contractDate: "", orderDate: "", doneDate: "", company: "", ceo: "", address: "", bizNo: "", phone: "", entity: "법인",
  industries: [], selected: [], workType: "", defectRate: "2", defect: "", auto: { payAmount: true, bond: true, defect: true },
};

const num = (s: string) => Number(String(s).replace(/[^\d]/g, "")) || 0;
const comma = (s: string) => (num(s) ? num(s).toLocaleString() : "");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** 금액에서 계산하는 값: 계약보증금 10%(원 미만 버림), 하자보수보증금 율%(백원 미만 버림 — 서식 예시 기준) */
function withAuto(f: Form): Form {
  const a = num(f.amount);
  const rate = Number(f.defectRate) || 0;
  return {
    ...f,
    payAmount: f.auto.payAmount ? (a ? String(a) : "") : f.payAmount,
    bond: f.auto.bond ? (a ? String(Math.floor(a * 0.1)) : "") : f.bond,
    defect: f.auto.defect ? (a && rate ? String(Math.floor((a * rate) / 100 / 100) * 100) : "") : f.defect,
  };
}

/** 서식(이전 계약서)에 들어 있던, 계약마다 잘 안 바뀌는 값 */
function templateDefaults(t: TemplateInfo | null): Partial<Defaults> {
  const f = t?.found ?? {};
  const kind = f.kind?.text.match(/\[\s*√\s*\]\s*(공사|물품|용역)/)?.[1] as Defaults["kind"] | undefined;
  const rate = f.defect?.text.match(/\(\s*([\d.]+)\s*%/)?.[1];
  return { kind, delayRate: f.delayRate?.text, etc: f.etc?.text, workType: f.workType?.text, defectRate: rate ? Number(rate) : undefined };
}

export default function ContractPage() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [template, setTemplate] = useState<File | null>(null);
  const [tinfo, setTinfo] = useState<TemplateInfo | null>(null);
  const [companies, setCompanies] = useState<Record<string, Company>>({});
  const [defaults, setDefaults] = useState<Defaults>(DEFAULTS);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const draftRef = useRef<HTMLInputElement>(null), bizRef = useRef<HTMLInputElement>(null), tplRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Form>) => setForm((f) => withAuto({ ...f, ...patch }));

  // 처음: 저장된 업체·기본값·서식
  useEffect(() => {
    setCompanies(loadCompanies());
    const d = loadDefaults();
    setDefaults(d);
    setForm((f) => withAuto({ ...f, kind: d.kind, delayRate: d.delayRate, etc: d.etc, workType: d.workType, defectRate: String(d.defectRate), contractDate: today() }));
    loadTemplate(TPL_KEY).then((f) => f && applyTemplate(f, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyTemplate(f: File, remember = true) {
    try {
      const { readContractTemplate } = await import("@/lib/contract/loaders");
      const info = await readContractTemplate(f);
      setTemplate(f); setTinfo(info);
      if (remember) saveTemplate(f, TPL_KEY);
      // 비어 있는 칸만 서식 값으로 (지체상금율·기타·공종처럼 계약마다 잘 안 바뀌는 값)
      const td = templateDefaults(info);
      setForm((cur) => withAuto({
        ...cur,
        delayRate: cur.delayRate || td.delayRate || "", etc: cur.etc || td.etc || "", workType: cur.workType || td.workType || "",
        // 계약 종류·하자보수율: 이 사이트에서 계약서를 만든 적이 없으면 서식 값으로
        ...(hasDefaults() ? {} : { kind: td.kind ?? cur.kind, defectRate: String(td.defectRate ?? cur.defectRate) }),
      }));
      if (remember) setMsg({ kind: "ok", text: `계약서 서식으로 ${f.name}을(를) 씁니다. 서식에서 칸 ${Object.keys(info.found).length}개를 찾았습니다.` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "계약서 서식을 읽지 못했습니다." }); }
  }

  async function openDraft(f: File) {
    setBusy("draft"); setMsg(null);
    try {
      const { readPdfRows } = await import("@/lib/contract/loaders");
      const d = parseDraft(await readPdfRows(f));
      if (!d.name && !d.amount) throw new Error("결재문서에서 계약명·금액을 찾지 못했습니다.");
      // 납품장소: 서식이 "농업기술센터 …"처럼 기관명으로 시작하면 같은 식으로
      const prefix = tinfo?.found.place?.text.match(/^(농업기술센터)\s/)?.[1];
      const place = d.place && prefix && !d.place.startsWith(prefix) ? `${prefix} ${d.place}` : d.place;
      set({ name: d.name, amount: d.amount ? String(d.amount) : form.amount, term: d.period ? contractTerm(d.period) : form.term, place: place || form.place });
      setMsg({ kind: "ok", text: `결재문서에서 계약명 · 금액${d.amount ? ` ${d.amount.toLocaleString()}원` : ""} · 기간 · 장소를 채웠습니다.` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "결재문서 PDF를 읽지 못했습니다." }); }
    finally { setBusy(null); }
  }

  async function openBiz(f: File) {
    setBusy("biz"); setMsg(null);
    try {
      const { readPdfRows } = await import("@/lib/contract/loaders");
      const b = parseBizCert(await readPdfRows(f));
      if (!b.bizNo && !b.company) throw new Error("사업자등록증에서 등록번호·상호를 찾지 못했습니다.");
      const saved = companies[b.bizNo];
      set({
        company: b.company, ceo: b.ceo, address: b.address, bizNo: b.bizNo, entity: b.entity, industries: b.industries,
        selected: saved?.selected?.filter((s) => b.industries.includes(s)).length ? saved.selected.filter((s) => b.industries.includes(s)) : b.industries,
        phone: saved?.phone ?? "",
      });
      setMsg({ kind: "ok", text: `사업자등록증에서 ${b.company} 정보를 채웠습니다.${saved ? " 저장된 전화번호·업종 선택도 불러왔습니다." : " 전화번호는 사업자등록증에 없어 입력해 주세요."}` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "사업자등록증 PDF를 읽지 못했습니다." }); }
    finally { setBusy(null); }
  }

  function pickCompany(bizNo: string) {
    const c = companies[bizNo];
    if (c) set({ company: c.company, ceo: c.ceo, address: c.address, bizNo: c.bizNo, phone: c.phone, entity: c.entity, industries: c.industries, selected: c.selected });
  }

  const data: ContractData = useMemo(() => ({
    name: form.name.trim(), amount: num(form.amount), payAmount: num(form.payAmount), bond: num(form.bond), delayRate: form.delayRate.trim(), term: form.term.trim(),
    place: form.place.trim(), etc: form.etc.trim(), company: form.company.trim(), ceo: form.ceo.trim(), address: form.address.trim(), bizNo: form.bizNo.trim(),
    phone: form.phone.trim(), entity: form.entity, industries: form.industries.filter((s) => form.selected.includes(s)), kind: form.kind,
    contractDate: form.contractDate, orderDate: form.orderDate, doneDate: form.doneDate, workType: form.workType.trim(),
    defectRate: Number(form.defectRate) || 0, defectAmount: num(form.defect),
  }), [form]);
  const changes = useMemo(() => (tinfo ? buildRules(tinfo, data).changes : []), [tinfo, data]);

  const REQUIRED: [keyof ContractData, string][] = [["name", "계약명"], ["amount", "계약금액"], ["company", "상호"], ["ceo", "대표자"], ["address", "주소"], ["bizNo", "사업자등록번호"], ["contractDate", "계약일"]];
  const missing = REQUIRED.filter(([k]) => !data[k]).map(([, l]) => l);
  const blanks = changes.filter((c) => !c.missing && c.from && !c.to).map((c) => c.label);

  async function generate() {
    if (!template) { tplRef.current?.click(); return; }
    if (missing.length) { setMsg({ kind: "err", text: `먼저 채워 주세요: ${missing.join(", ")}` }); return; }
    setBusy("make"); setMsg(null);
    try {
      const { buildContractHwpx } = await import("@/lib/contract/loaders");
      const { blob } = await buildContractHwpx(template, data);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `표준계약서(${data.name}).hwpx`.replace(/[\\/:*?"<>|]/g, "_") });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      // 업체 정보·기본값 기억
      const next = { ...companies, [data.bizNo]: { bizNo: data.bizNo, company: data.company, ceo: data.ceo, address: data.address, phone: data.phone, entity: data.entity, industries: form.industries, selected: form.selected, updatedAt: new Date().toISOString() } };
      setCompanies(next); saveCompanies(next);
      const nd: Defaults = { ...defaults, kind: data.kind, delayRate: data.delayRate, etc: data.etc, workType: data.workType, defectRate: data.defectRate };
      setDefaults(nd); saveDefaults(nd);
      setMsg({ kind: "ok", text: `계약서를 만들었습니다. 한글에서 열어 확인해 주세요.${blanks.length ? ` 비워 둔 칸(${blanks.join(", ")})은 빈칸으로 들어갔습니다.` : ""}` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "계약서를 만들지 못했습니다." }); }
    finally { setBusy(null); }
  }

  const edit = tab === "edit";
  const hint = (t?: string) => (edit && t ? <span className="dold">{t}</span> : null);
  /** 글 칸: 입력 화면이면 입력칸, 미리보기면 글자 */
  const T = (k: keyof Form, opt: { need?: boolean; placeholder?: string } = {}) => {
    const v = String(form[k] ?? "");
    return edit ? <Txt value={v} need={opt.need} placeholder={opt.placeholder} onChange={(x) => set({ [k]: x } as Partial<Form>)} /> : v || (opt.need ? <em>입력 필요</em> : <span className="cempty">빈칸</span>);
  };
  /** 금액 칸: 숫자만 입력, 옆에 계약서 표기 */
  const M = (k: "amount" | "payAmount" | "bond" | "defect", opt: { need?: boolean; autoKey?: keyof Form["auto"]; short?: boolean } = {}) => {
    const n = num(form[k]);
    const text = n ? (opt.short ? `금${n.toLocaleString()}원` : moneyText(n)) : "";
    if (!edit) return text || (opt.need ? <em>입력 필요</em> : <span className="cempty">빈칸</span>);
    return (
      <span className="cmoney">
        <span className="cmoney-in"><input inputMode="numeric" className={`dcellin num${opt.need && !n ? " need" : ""}`} value={comma(form[k])} placeholder="0" onChange={(e) => set({ [k]: e.target.value.replace(/[^\d]/g, ""), ...(opt.autoKey ? { auto: { ...form.auto, [opt.autoKey]: false } } : {}) } as Partial<Form>)} />원</span>
        {opt.autoKey && (form.auto[opt.autoKey] ? <span className="ctag">자동</span> : <button type="button" className="suggest" onClick={() => set({ auto: { ...form.auto, [opt.autoKey!]: true } })}>자동 계산으로</button>)}
        {text && !opt.short && <span className="dold">{text}</span>}
      </span>
    );
  };
  /** 날짜 칸: "2026. 11. 23." 표기 */
  const Dt = (k: "contractDate" | "orderDate" | "doneDate", need = false) =>
    edit ? <input type="date" className={`dcellin cdate${need && !form[k] ? " need" : ""}`} value={form[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<Form>)} />
      : form[k] ? dotDate(form[k]) : need ? <em>입력 필요</em> : <span className="cempty">빈칸</span>;
  /** 체크 칸: [√] 용역 */
  const Check = <K extends "kind" | "entity">(k: K, options: readonly Form[K][]) => (
    <span className="cbox">{options.map((o) => (
      <button key={o} type="button" disabled={!edit} className={form[k] === o ? "on" : ""} onClick={() => set({ [k]: o } as Partial<Form>)}>[{form[k] === o ? "√" : " "}] {o}</button>
    ))}</span>
  );
  const name = form.name || "○○○";

  return (
    <main className="shell">
      <header>
        <div className="brand"><div className="brand-icon">계</div><div><div className="eyebrow">CONTRACT</div><h1>계약서 도우미</h1></div></div>
        <div className="location"><Info size={15} /> 파일은 이 브라우저 안에서만 처리됩니다</div>
      </header>

      <section className="panel filters">
        <div className="filter-title">
          <div><strong>파일 불러오기</strong><p>결재문서와 사업자등록증 PDF에서 값을 읽고, 이전에 작성한 계약서(hwpx)를 서식으로 써서 같은 모양의 새 계약서를 만듭니다.</p></div>
          <span className="station">저장된 업체 {Object.keys(companies).length}곳</span>
        </div>
        <div className="budget-actions">
          <button onClick={() => draftRef.current?.click()} disabled={!!busy}>{busy === "draft" ? <RefreshCw className="spin" size={16} /> : <FileUp size={16} />} 결재문서 PDF</button>
          <button onClick={() => bizRef.current?.click()} disabled={!!busy}>{busy === "biz" ? <RefreshCw className="spin" size={16} /> : <Building2 size={16} />} 사업자등록증 PDF</button>
          {Object.keys(companies).length > 0 && (
            <select className="csel" value="" onChange={(e) => pickCompany(e.target.value)} title="전에 계약한 업체 정보 불러오기">
              <option value="">저장된 업체 불러오기…</option>
              {Object.values(companies).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => <option key={c.bizNo} value={c.bizNo}>{c.company} ({c.bizNo})</option>)}
            </select>
          )}
          <button className="secondary" onClick={() => tplRef.current?.click()} disabled={!!busy}><FileText size={15} /> {template ? "계약서 서식 바꾸기" : "계약서 서식(hwpx) 고르기"}</button>
          <span className="budget-actions-sep" />
          <button onClick={generate} disabled={!!busy}>{busy === "make" ? <RefreshCw className="spin" size={16} /> : <FileDown size={16} />} 계약서 hwpx 만들기</button>
          <input ref={draftRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) openDraft(f); }} />
          <input ref={bizRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) openBiz(f); }} />
          <input ref={tplRef} type="file" accept=".hwpx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) applyTemplate(f); }} />
        </div>
        <p className="bhint">{template ? <>서식: <b>{template.name}</b> — 이 파일에 적힌 이전 계약 값을 새 값으로 바꿉니다. 글자 모양·표는 그대로 둡니다.</> : "이전에 작성한 계약서 hwpx를 서식으로 한 번 골라 주세요. 다음부터는 기억합니다."}</p>
        {msg && <div className={msg.kind === "err" ? "error" : "okmsg"}>{msg.text}</div>}
      </section>

      <section className="panel budget-detail">
        <div className="chart-title">
          <div><div className="eyebrow">표준계약서 · 부속 서류</div><h3>{form.name || "새 계약"}</h3></div>
          <div className="tabs">
            <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>입력</button>
            <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>미리보기</button>
          </div>
        </div>
        {edit && <p className="bhint">계약서 모양 그대로 입력합니다. <span className="need-sample" /> 노란 칸은 꼭 채워야 하는 칸입니다. 회색 글씨는 계약서에 들어갈 표기입니다.</p>}

        <div className={`bpreview cdoc${edit ? " editing" : ""}`}>
          {/* ---------- 표준계약서 ---------- */}
          <div className="cdoc-title">표 준 계 약 서</div>
          <table className="bp-table cform"><tbody>
            <tr><th colSpan={2}>발주처</th><td colSpan={2} className="cfixed">영광군농업기술센터 재무관 <small>(서식 그대로)</small></td></tr>
            <tr>
              <th colSpan={2}>계약상대자</th>
              <td>
                <div className="crow"><span>∙ 상&nbsp;&nbsp;호:</span>{T("company", { need: true })}</div>
                <div className="crow"><span>∙ 주&nbsp;&nbsp;소:</span>{T("address", { need: true })}</div>
                <div className="crow"><span>∙ 대표자:</span>{T("ceo", { need: true, placeholder: "여러 명이면 쉼표로" })}</div>
              </td>
              <td>
                <div className="crow"><span>∙ 사업자등록번호:</span>{T("bizNo", { need: true, placeholder: "000-00-00000" })}</div>
                <div className="crow"><span>∙ 전화번호:</span>{T("phone", { placeholder: "사업자등록증에 없어 직접 입력" })}</div>
              </td>
            </tr>
            <tr><th rowSpan={8} className="cvert">계<br />약<br />내<br />용</th><th>계약명</th><td colSpan={2}>{T("name", { need: true, placeholder: "결재문서 PDF를 열면 채워집니다" })}</td></tr>
            <tr><th>계약금액</th><td colSpan={2}>{M("amount", { need: true })}</td></tr>
            <tr><th>지급금액</th><td colSpan={2}>{M("payAmount", { autoKey: "payAmount" })}</td></tr>
            <tr><th>계약보증금</th><td colSpan={2}>{M("bond", { autoKey: "bond" })}{hint("계약금액의 10%")}</td></tr>
            <tr><th>지체상금율</th><td colSpan={2}>{T("delayRate", { placeholder: "1,000분의1.3(1.3%)" })}</td></tr>
            <tr><th>계약기한</th><td colSpan={2}>{T("term", { placeholder: "계약일로부터 30일 이내" })}{hint("결재문서의 '착공일로부터'는 '계약일로부터'로 바꿔 넣습니다")}</td></tr>
            <tr><th>납품장소</th><td colSpan={2}>{T("place")}</td></tr>
            <tr><th>기타</th><td colSpan={2}>{T("etc", { placeholder: "견적(내역)서 참조" })}</td></tr>
          </tbody></table>
          <p className="cpara">영광군농업기술센터재무관과 계약 대상자는 붙임의 계약 문서에 의하여 위의 공사/물품/용역 계약을 체결하고, 신의에 따라 성실히 계약상의 의무를 이행할 것을 확약하며, … 각각 1통씩 보관한다.</p>
          <div className="cdate-line">{Dt("contractDate", true)}{hint("계약일 — 각서·확인서의 날짜도 모두 이 날짜로 바뀝니다")}</div>
          <div className="csign">
            <div>계&nbsp;&nbsp;약&nbsp;&nbsp;자 : 영광군농업기술센터 재무관</div>
            <div>계약 상대자 : {form.company || "○○○"} {form.ceo}</div>
          </div>

          {/* ---------- 부속 서류: 다른 쪽에만 있는 칸 ---------- */}
          <h4>수의계약 체결 제한 여부 확인서</h4>
          <table className="bp-table cform"><tbody>
            <tr><th>발주날짜</th><td>{Dt("orderDate")}</td><th>발주내용</th><td>{name}</td></tr>
            <tr><th>계약 종류</th><td colSpan={3}>{Check("kind", ["공사", "물품", "용역"] as const)}</td></tr>
            <tr><th>계약상대자</th><td colSpan={3}>{Check("entity", ["개인", "법인"] as const)} <span className="cmuted">{form.company} · {form.phone || "전화번호 없음"}</span></td></tr>
          </tbody></table>

          <h4>수의계약체결 각서 — 업종(등록)</h4>
          {form.industries.length ? (
            <div className="cchecks">{form.industries.map((s) => {
              const on = form.selected.includes(s);
              return edit
                ? <label key={s}><input type="checkbox" checked={on} onChange={(e) => set({ selected: e.target.checked ? form.industries.filter((x) => x === s || form.selected.includes(x)) : form.selected.filter((x) => x !== s) })} /> <span>{s}</span></label>
                : on ? <div key={s}>{s}</div> : null;
            })}</div>
          ) : <p className="bhint">사업자등록증 PDF를 열면 업태(종목) 목록이 나옵니다. 계약서에 넣을 업종만 체크하세요.</p>}

          <h4>하자보수 이행 각서</h4>
          <table className="bp-table cform"><tbody>
            <tr><th>계약일자</th><td>{form.contractDate ? dotDate(form.contractDate) : <span className="cempty">위 계약일</span>}</td><th>준공일자</th><td>{Dt("doneDate")}</td></tr>
            <tr><th>공종</th><td>{T("workType", { placeholder: "시설물유지관리" })}</td><th>하자보수보증금</th>
              <td><span className="cmoney"><span className="cmoney-in">(
                {edit ? <input className="dcellin num crate" value={form.defectRate} onChange={(e) => set({ defectRate: e.target.value.replace(/[^\d.]/g, "") })} /> : form.defectRate}%)</span>
                {M("defect", { autoKey: "defect", short: true })}</span>
                {hint("계약금액×율에서 백원 미만을 버린 값 (서식 예시 기준)")}</td></tr>
          </tbody></table>
          <p className="bhint">물품검사(수)조서·청렴서약서처럼 서식에서 비어 있는(OOO) 부분은 그대로 둡니다.</p>
        </div>

        {!edit && (
          <>
            <div className="bsection">서식(이전 계약서)과 비교 — 바뀌는 값</div>
            {!tinfo ? <p className="bhint">계약서 서식(hwpx)을 고르면 바뀌는 값을 확인할 수 있습니다.</p> : (
              <table className="bp-table cchanges"><thead><tr><th>항목</th><th>서식 값</th><th>새 값</th></tr></thead>
                <tbody>{changes.map((c) => (
                  <tr key={c.key} className={c.missing ? "miss" : c.from === c.to ? "same" : ""}>
                    <th>{c.label}</th><td>{c.missing ? <em>서식에서 못 찾음</em> : c.from}</td><td>{c.missing ? "" : c.to || <em>빈칸</em>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {tinfo && changes.some((c) => c.missing) && <p className="bhint"><AlertTriangle size={12} /> &lsquo;서식에서 못 찾음&rsquo; 항목은 서식에 그 칸이 없어 바꾸지 않습니다.</p>}
          </>
        )}
      </section>
      <footer>PDF와 hwpx는 서버로 전송되지 않고 이 브라우저에서만 읽습니다. 업체 정보(상호·주소·전화번호 등)는 이 브라우저에만 저장됩니다.</footer>
    </main>
  );
}
