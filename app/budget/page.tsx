"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Txt from "@/app/components/Txt";
import { AlertTriangle, CheckCircle2, Download, FileDown, FileText, FileUp, Info, RefreshCw, Search, Upload, Wand2 } from "lucide-react";
import { emptyMaster, normName, PREREQ_KEYS, type BudgetDoc, type MasterInfo, type Project } from "@/lib/budget/types";
import { validateProject } from "@/lib/budget/parsePdf";
import { calcRows, calcStyleOf, calcTextLines, defaultPeriod, investRows, mil, needsPrevFunds, overviewItems, reqFor, statChangeText, statsOf, suggestSubsidyRate, suggestSupportForm, won } from "@/lib/budget/derive";
import { exportJson, findMaster, loadStore, parseBackup, saveStore, type MasterStore } from "@/lib/budget/store";
import { applyEdit, forYear, MID_PLAN, type YearView } from "@/lib/budget/yearly";
import { loadTemplate, saveTemplate } from "@/lib/budget/templateStore";

const EXCLUDE = /행정운영경비/; // 세부사업설명서에 넣지 않는 정책사업
const REQUIRED: [keyof MasterInfo, string][] = [["org", "조직"], ["basis", "지원근거"], ["purpose", "사업목적"]];

function statusOf(p: Project, v: YearView) {
  if (validateProject(p).length) return "error" as const;
  const m = v.m;
  if (!m || REQUIRED.some(([k]) => !m[k]) || needsPrevFunds(p, m) || !m.prereq?.[MID_PLAN] || Object.values(m.prereq ?? {}).some((x) => x === "") || v.reqStale) return "todo" as const;
  return "done" as const;
}

export default function BudgetPage() {
  const [doc, setDoc] = useState<BudgetDoc | null>(null);
  const [store, setStore] = useState<MasterStore>({});
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [template, setTemplate] = useState<File | null>(null); // hwpx 만들 때 서식으로 쓸 기존 설명서
  const pendingExport = useRef<{ names: string[] | null } | null>(null); // 서식을 고른 뒤 이어서 만들 대상
  const pdfRef = useRef<HTMLInputElement>(null), hwpxRef = useRef<HTMLInputElement>(null), jsonRef = useRef<HTMLInputElement>(null), tplRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStore(loadStore());
    loadTemplate().then((f) => f && setTemplate((cur) => cur ?? f)); // 전에 쓴 서식 hwpx
  }, []);
  // 서식 hwpx 기억 (다음에 페이지를 열어도 다시 고르지 않도록)
  const rememberTemplate = (f: File) => { setTemplate(f); saveTemplate(f); };
  const commit = (next: MasterStore) => { setStore(next); if (!saveStore(next)) setMsg({ kind: "err", text: "브라우저에 저장하지 못했습니다. 백업 파일로 내보내 두세요." }); };

  async function openPdf(f: File) {
    setBusy("pdf"); setMsg(null);
    try {
      const { readBudgetPdf } = await import("@/lib/budget/loaders");
      const d = await readBudgetPdf(f);
      setDoc(d); setSel(d.projects[0]?.name ?? null);
      const bad = d.projects.filter((p) => validateProject(p).length).length;
      setMsg({ kind: bad ? "err" : "ok", text: `${d.title || f.name} · 세부사업 ${d.projects.length}개를 읽었습니다.${bad ? ` 합계가 맞지 않는 사업 ${bad}개는 목록에 ⚠로 표시했습니다.` : " 모든 합계가 맞습니다."}` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "PDF를 읽지 못했습니다." }); }
    finally { setBusy(null); }
  }

  async function importHwpx(f: File) {
    setBusy("hwpx"); setMsg(null);
    try {
      const { readDescriptionHwpx } = await import("@/lib/budget/loaders");
      const list = await readDescriptionHwpx(f);
      rememberTemplate(f);
      // hwpx 파일이 저장된 시각을 기준으로, 이 사이트에서 그 뒤에 고친 사업은 덮어쓰지 않는다
      const fileTime = new Date(f.lastModified || Date.now()).toISOString();
      const next = { ...store };
      let added = 0, kept = 0;
      for (const { titleName, ...m } of list) {
        const k = normName(m.name);
        if (next[k]?.updatedAt && next[k].updatedAt > fileTime) { kept++; continue; }
        next[k] = { ...m, calcStyle: { ...next[k]?.calcStyle, ...m.calcStyle }, updatedAt: fileTime }; added++;
      }
      commit(next);
      setMsg({ kind: "ok", text: `${f.name}에서 세부사업 ${added}개의 정보를 가져왔습니다.${kept ? ` 이 파일보다 나중에 사이트에서 고친 ${kept}개는 고친 내용을 유지했습니다.` : ""}` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "hwpx를 읽지 못했습니다." }); }
    finally { setBusy(null); }
  }

  // hwpx 만들기: names가 없으면 전체(행정운영경비 제외)
  async function exportHwpx(names: string[] | null, tpl: File | null = template) {
    if (!doc) return;
    const targets = names ? projects.filter((p) => names.includes(p.name)) : projects.filter((p) => !EXCLUDE.test(p.policy));
    if (!tpl) { pendingExport.current = { names }; tplRef.current?.click(); return; }
    setBusy("export"); setMsg(null);
    try {
      const { buildDescriptionHwpx } = await import("@/lib/budget/loaders");
      const year = doc.year ?? new Date().getFullYear() + 1;
      const views = targets.map((p) => ({ p, v: viewOf(p) }));
      const items = views.map(({ p, v }) => ({ p, m: v.m })); // 다른 연도 값은 빼고
      const blob = await buildDescriptionHwpx(tpl, items, year);
      const name = targets.length === 1 ? `세부사업설명서_${targets[0].name}.hwpx` : `세부사업설명서_${year}_${new Date().toISOString().slice(0, 10)}.hwpx`;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name.replace(/[\/:*?"<>|]/g, "_") });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const todo = views.filter(({ p, v }) => statusOf(p, v) !== "done").length;
      setMsg({ kind: "ok", text: `세부사업 ${items.length}개로 hwpx를 만들었습니다 (서식: ${tpl.name}).${todo ? ` 입력이 덜 된 ${todo}개 사업은 빈칸으로 들어갔습니다.` : ""}${names ? "" : " 행정운영경비는 뺐습니다."} 한글에서 열어 확인해 주세요.` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "hwpx를 만들지 못했습니다." }); }
    finally { setBusy(null); }
  }

  async function importJson(f: File) {
    try {
      const data = parseBackup(await f.text());
      commit({ ...store, ...data });
      setMsg({ kind: "ok", text: `백업에서 ${Object.keys(data).length}개 사업 정보를 불러왔습니다.` });
    } catch (e: any) { setMsg({ kind: "err", text: e.message || "백업 파일을 읽지 못했습니다." }); }
  }

  const projects = doc?.projects ?? [];
  const masters = useMemo(() => new Map(projects.map((p) => [p.name, findMaster(store, p.name)])), [projects, store]);
  const current = projects.find((p) => p.name === sel) ?? null;
  const currentFound = current ? masters.get(current.name) ?? null : null;
  const year = doc?.year ?? null;
  // 이 PDF 연도에 써도 되는 정보 (다른 연도의 사업기간·전년도 재원·중기재정계획·비고는 비움)
  const viewOf = (p: Project) => forYear(store[normName(p.name)] ?? masters.get(p.name)?.info ?? null, year);

  // 입력값 저장: 항상 PDF 사업명 기준 키로 저장 (비슷한 이름에서 가져온 정보도 이때 복사)
  function update(patch: Partial<MasterInfo>) {
    if (!current) return;
    const k = normName(current.name);
    const raw = store[k] ?? (currentFound ? { ...currentFound.info, name: current.name } : emptyMaster(current.name));
    commit({ ...store, [k]: { ...applyEdit(raw, patch, year), name: current.name } });
  }

  const filtered = projects.filter((p) => !q || normName(p.name).includes(normName(q)) || normName(p.unit).includes(normName(q)));
  const groups = useMemo(() => {
    const g = new Map<string, Project[]>();
    for (const p of filtered) { const k = `${p.policy} › ${p.unit}`; g.set(k, [...(g.get(k) ?? []), p]); }
    return [...g.entries()];
  }, [filtered]);
  const counts = useMemo(() => {
    const c = { done: 0, todo: 0, error: 0 };
    for (const p of projects) c[statusOf(p, viewOf(p))]++;
    return c;
  }, [projects, masters, store, year]);

  return (
    <main className="shell">
      <header>
        <div className="brand"><div className="brand-icon">예</div><div><div className="eyebrow">BUDGET DOCUMENT</div><h1>세부사업설명서 도우미</h1></div></div>
        <div className="location"><Info size={15} /> 파일은 이 브라우저 안에서만 처리됩니다</div>
      </header>

      <section className="panel filters">
        <div className="filter-title">
          <div><strong>파일 불러오기</strong><p>세출예산사업명세서 PDF에서 숫자를 읽고, PDF에 없는 정보는 아래에서 입력하거나 기존 설명서(hwpx)에서 가져옵니다.</p></div>
          <span className="station">저장된 사업 정보 {Object.keys(store).length}건</span>
        </div>
        <div className="budget-actions">
          <button onClick={() => pdfRef.current?.click()} disabled={!!busy}>{busy === "pdf" ? <RefreshCw className="spin" size={16} /> : <FileUp size={16} />} 세출예산사업명세서 PDF 열기</button>
          <button className="secondary" onClick={() => hwpxRef.current?.click()} disabled={!!busy}>{busy === "hwpx" ? <RefreshCw className="spin" size={15} /> : <FileText size={15} />} 기존 설명서(hwpx)에서 정보 가져오기</button>
          <button onClick={() => exportHwpx(null)} disabled={!!busy || !doc} title={template ? `서식: ${template.name}` : "서식으로 쓸 기존 설명서(hwpx)를 고릅니다"}>{busy === "export" ? <RefreshCw className="spin" size={16} /> : <FileDown size={16} />} 세부사업설명서 hwpx 만들기</button>
          <span className="budget-actions-sep" />
          <button className="secondary" onClick={() => exportJson(store)} disabled={!Object.keys(store).length}><Download size={15} /> 입력 정보 백업</button>
          <button className="secondary" onClick={() => jsonRef.current?.click()}><Upload size={15} /> 백업 불러오기</button>
          <input ref={pdfRef} type="file" accept=".pdf,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openPdf(f); e.target.value = ""; }} />
          <input ref={hwpxRef} type="file" accept=".hwpx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importHwpx(f); e.target.value = ""; }} />
          <input ref={tplRef} type="file" accept=".hwpx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { rememberTemplate(f); const pending = pendingExport.current; pendingExport.current = null; if (pending) exportHwpx(pending.names, f); } }} />
          <input ref={jsonRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
        </div>
        {doc && <p className="bhint">hwpx는 기존 설명서의 글자 모양·표 테두리를 서식으로 씁니다. {template ? <>서식: <b>{template.name}</b> <button type="button" className="linkbtn" onClick={() => tplRef.current?.click()}>바꾸기</button></> : "만들 때 서식으로 쓸 기존 설명서(hwpx)를 한 번 골라 주세요."}</p>}
        {msg && <div className={msg.kind === "err" ? "error" : "okmsg"}>{msg.text}</div>}
      </section>

      {!doc ? (
        <div className="empty panel">
          <div className="empty-icon"><FileText size={30} /></div>
          <h3>세출예산사업명세서 PDF를 열어 주세요</h3>
          <p>e-호조에서 출력한 PDF를 열면 세부사업별 투자계획·산출근거가 자동으로 채워집니다.<br />조직·지원근거·사업목적 같은 정보는 한 번 입력하면 이 브라우저에 저장되어 다음 해에도 다시 쓰입니다.</p>
          <div className="empty-tags"><span>투자계획 (백만원)</span><span>보조율 제안</span><span>산출근거 표</span><span>합계 자동 검증</span></div>
        </div>
      ) : (
        <div className="budget-grid">
          <aside className="panel budget-list">
            <div className="budget-search"><Search size={15} /><input placeholder="사업명 검색" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="budget-counts"><span className="done">완료 {counts.done}</span><span className="todo">입력 필요 {counts.todo}</span>{counts.error > 0 && <span className="error">합계 오류 {counts.error}</span>}</div>
            <div className="budget-items">
              {groups.map(([g, ps]) => (
                <div key={g}>
                  <div className="budget-group">{g}</div>
                  {ps.map((p) => {
                    const st = statusOf(p, viewOf(p));
                    return (
                      <button key={p.name} className={`budget-item ${sel === p.name ? "active" : ""}`} onClick={() => setSel(p.name)}>
                        <span className={`dot ${st}`} title={st === "done" ? "입력 완료" : st === "todo" ? "입력 필요" : "합계 오류"} />
                        <span className="name">{p.name}</span>
                        <span className="amt">{mil(p.cur)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </aside>

          {current && (
            <section className="panel budget-detail">
              <div className="chart-title">
                <div><div className="eyebrow">{current.policy} › {current.unit}</div><h3>{current.name}</h3></div>
                <div className="tabs">
                  <button onClick={() => exportHwpx([current.name])} disabled={!!busy} title="이 사업만 hwpx로 만들기"><FileDown size={13} /> 이 사업만</button>
                  <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>입력</button>
                  <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>미리보기</button>
                </div>
              </div>
              <ProjectNotices p={current} found={currentFound} hasOwn={!!store[normName(current.name)]} />
              {tab === "edit"
                ? <DocView key={current.name} p={current} year={doc.year} view={viewOf(current)} onChange={update} />
                : <DocView p={current} year={doc.year} view={viewOf(current)} />}
            </section>
          )}
        </div>
      )}
      <footer>PDF와 hwpx는 서버로 전송되지 않고 이 브라우저에서만 읽습니다. 입력한 정보는 이 브라우저에만 저장되므로, 다른 PC에서 쓰거나 공유하려면 &lsquo;입력 정보 백업&rsquo;으로 내보내 주세요.</footer>
    </main>
  );
}

function ProjectNotices({ p, found, hasOwn }: { p: Project; found: { info: MasterInfo; exact: boolean } | null; hasOwn: boolean }) {
  const errs = validateProject(p);
  return (
    <>
      {errs.length > 0 && <div className="error"><AlertTriangle size={14} /> PDF 합계가 맞지 않습니다: {errs.join(" / ")}</div>}
      {found && !found.exact && !hasOwn && <div className="notice"><p>ⓘ 이름이 비슷한 &lsquo;{found.info.name}&rsquo;의 저장 정보를 불러왔습니다. 고치면 이 사업 이름으로 새로 저장됩니다.</p></div>}
    </>
  );
}

type Edit = ((patch: Partial<MasterInfo>) => void) | undefined;

// 사업개요 항목 (입력 화면은 빈 항목도 모두 보여 준다)
const OV: { label: string; key: keyof MasterInfo; need?: boolean; placeholder?: string }[] = [
  { label: "지원근거", key: "basis", need: true, placeholder: "｢농촌진흥법｣ 제15조" },
  { label: "사업목적", key: "purpose", need: true },
  { label: "사업기간", key: "period" },
  { label: "사 업 비", key: "name" }, // PDF 값 (입력 안 함)
  { label: "사업내용", key: "content", placeholder: "여러 줄이면 Enter로 나눠 쓰세요 (- 내용)" },
  { label: "지원대상", key: "target", placeholder: "직접수행이면 비워도 됩니다" },
  { label: "지원형태", key: "supportForm" },
  { label: "보 조 율", key: "subsidyRate" },
];

/** 세부사업설명서 문서 모양. onChange가 있으면 입력 화면, 없으면 미리보기 */
function DocView({ p, year, view, onChange }: { p: Project; year: number | null; view: YearView; onChange?: Edit }) {
  const { m, stale, reqStale } = view;
  const v = m ?? emptyMaster(p.name);
  const old = (s: string | undefined) => (stale && s ? <span className="dold">{stale.year}년 값(참고): {s}</span> : null);
  const edit = !!onChange;
  const set = (patch: Partial<MasterInfo>) => onChange?.(patch);
  const y = year ?? new Date().getFullYear() + 1;
  const stats = statsOf(p);
  const rows = investRows(p, m);
  const multiFund = rows.filter((r) => r.label !== "계" && r.a !== null).length > 1 && (p.prev ?? 0) > 0;
  const missing = (t: string) => <em>{t}</em>;
  const suggestions: Partial<Record<keyof MasterInfo, string>> = { supportForm: suggestSupportForm(p), subsidyRate: suggestSubsidyRate(p), period: defaultPeriod(year) };

  const ovValue = (key: keyof MasterInfo) => (key === "name" ? `${mil(p.cur)}백만원` : String(v[key] ?? ""));
  const ovList = edit ? OV : OV.filter((o) => overviewItems(p, m, year).some(([k]) => k === o.label));

  return (
    <div className={`bpreview${edit ? " editing" : ""}`}>
      {stale && <div className="notice"><p>ⓘ 저장된 사업기간·전년도 재원별 금액·사전절차 날짜(중기재정계획 등)·※ 비고는 <b>{stale.year}년</b> 예산 값이라 이 문서({year}년)에는 쓰지 않고 비워 두었습니다. 회색 글씨의 작년 값을 참고해 다시 넣어 주세요.</p></div>}
      {edit && <p className="bhint">문서 모양 그대로 입력합니다. <span className="need-sample" /> 노란 칸은 꼭 채워야 하는 칸, 회색 숫자는 PDF에서 가져온 값입니다.</p>}
      <div className="bp-type">&lt;{edit ? <input className="dinline" value={v.type} placeholder="단년·반복사업" onChange={(e) => set({ type: e.target.value })} /> : v.type || "단년·반복사업"}&gt;</div>
      <div className="bp-title">{p.name}</div>
      <table className="bp-head"><tbody>
        <tr>
          <td><span className="dlabel">조&nbsp;&nbsp;&nbsp;&nbsp;직:</span> {edit ? <Txt value={v.org} need placeholder="농업기술센터 농촌지원과 OO팀" onChange={(x) => set({ org: x })} /> : v.org || missing("입력 필요")}</td>
          <td>정책사업: {p.policy}</td>
        </tr>
        <tr><td>단위사업: {p.unit}</td><td>세부사업: {p.name}</td></tr>
      </tbody></table>

      <h4>□ 사업개요</h4>
      <div className="bp-ov">
        {ovList.map((o) => {
          const val = ovValue(o.key);
          const sug = suggestions[o.key];
          return (
            <div key={o.label}>
              <span>○ {o.label} :</span>
              {!edit || o.key === "name"
                ? <pre>{o.key === "name" ? <>{val} <small className="dsrc">({p.cur.toLocaleString()}천원, PDF)</small></> : val || sug}</pre>
                : <div className="dcell">
                    <Txt value={val} need={o.need} placeholder={sug || o.placeholder} onChange={(x) => set({ [o.key]: x } as Partial<MasterInfo>)} />
                    {sug && o.key !== "period" && sug !== val && <button type="button" className="suggest" onClick={() => set({ [o.key]: sug } as Partial<MasterInfo>)} title={sug}><Wand2 size={12} /> 제안값 넣기: {sug}</button>}
                    {o.key === "period" && old(stale?.period)}
                  </div>}
            </div>
          );
        })}
        {!edit && !v.basis && <div className="bp-missing">○ 지원근거 : 입력 필요</div>}
      </div>
      {edit && <p className="bhint">사업기간·지원형태·보조율은 비워 두면 흐린 글씨의 값이 들어갑니다. 보조율의 자부담, 국비(일반)/시비(전환) 구분은 PDF에 없어 직접 고쳐 주세요.</p>}

      <h4>□ 사전절차이행여부</h4>
      <table className="bp-table"><tbody>
        {[PREREQ_KEYS.slice(0, 3), PREREQ_KEYS.slice(3)].map((ks, i) => <tr key={i}>{ks.map((k) => {
          // 값이 없으면 "비대상". 단 중기재정계획과, 연도가 바뀌어 비운 날짜 칸("")은 꼭 입력
          const val = v.prereq?.[k];
          const must = k === MID_PLAN || val === "";
          const was = stale?.prereq?.[k];
          const change = (x: string) => {
            const next = { ...v.prereq };
            if (x === "" && !must) delete next[k]; else next[k] = x;
            set({ prereq: next });
          };
          return (
            <Fragment key={k}><th>{k}</th><td>{edit
              ? <input className={`dcellin${must && !val ? " need" : ""}`} value={val ?? ""} placeholder={was ? `작년 ${was}` : must ? "날짜 입력" : "비대상"} title={was ? `${stale!.year}년 값: ${was}` : undefined} onChange={(e) => change(e.target.value)} />
              : val || (must ? missing("입력 필요") : "비대상")}</td></Fragment>
          );
        })}</tr>)}
      </tbody></table>

      <h4>□ 투자계획 <small>(단위 : 백만원)</small></h4>
      <table className="bp-table num"><thead><tr><th>구 분</th><th>{y}년 예산액<br />(a)</th><th>{y - 1}년 예산액<br />(b)</th><th>{y - 1}년 대비 증감<br />(c=a-b)</th><th>증감률<br />(c/b)</th><th>비고</th></tr></thead>
        <tbody>{rows.map((r) => {
          const bEditable = edit && multiFund && r.label !== "계" && r.a !== null;
          const key = r.label as "국비" | "시비" | "군비" | "기타";
          return (
            <tr key={r.label} className={r.label === "계" ? "sum" : ""}>
              <th>{r.label}</th><td>{r.a ?? ""}</td>
              <td>{bEditable
                ? <input className={`dcellin num${(v.prevFunds?.[key] ?? "") === "" ? " need" : ""}`} value={v.prevFunds?.[key] ?? ""} placeholder={stale?.prevFunds?.[key] ? `작년 ${stale.prevFunds[key]}` : "입력"} onChange={(e) => set({ prevFunds: { ...v.prevFunds, [key]: e.target.value } })} />
                : r.b ?? (r.a !== null ? missing("입력") : "")}</td>
              <td>{r.c === null ? "" : r.c < 0 ? `△${-r.c}` : r.c}</td><td>{r.rate}</td><td>{r.note}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {edit && multiFund && <p className="bhint">재원이 둘 이상이면 전년도 재원별 금액이 PDF에 없어 (b)칸을 직접 넣어야 합니다. 전년도 합계: {mil(p.prev ?? 0)}백만원</p>}

      <h4>□ 산출근거</h4>
      {reqStale && (
        <div className="notice"><p>ⓘ ▶(요구) 사유는 지난 예산 때 문구입니다. 올해에도 맞는지 확인하고, 고칠 곳은 고쳐 주세요.
          {edit && <> <button type="button" className="suggest" onClick={() => set({ reqYear: year ?? undefined })}><CheckCircle2 size={12} /> 확인했음 (그대로 사용)</button></>}</p></div>
      )}
      <div className="bp-box">
        {stats.map((s) => {
          const style = calcStyleOf(m, s.name);
          const sk = s.name.replace(/\s/g, "");
          const req = reqFor(m, s.group, s.name, stats.length);
          return (
            <div key={s.code + s.name} className="bp-stat">
              <div className="bp-stat-head">○ {s.name} : {statChangeText(s)}</div>
              <div className="bp-req">&nbsp;▶ (요구) {edit ? <Txt value={req} need placeholder="요구 사유" stale={reqStale} onChange={(x) => set({ requests: { ...v.requests, [sk]: x } })} /> : req || missing("입력 필요")}</div>
              <div className="bp-calc-label">&nbsp;▶ (산출)
                {edit && s.lines.length > 0 && (
                  <span className="seg" role="group" aria-label="산출근거 형식">
                    <button type="button" className={style === "text" ? "on" : ""} onClick={() => set({ calcStyle: { ...v.calcStyle, [sk]: "text" } })}>글</button>
                    <button type="button" className={style === "table" ? "on" : ""} onClick={() => set({ calcStyle: { ...v.calcStyle, [sk]: "table" } })}>표</button>
                  </span>
                )}
              </div>
              {style === "table" ? (
                <table className="bp-table calc"><thead><tr><th>구분</th><th>산출내역</th><th>소요비용(원)</th><th>비고</th></tr></thead>
                  <tbody>
                    <tr className="sum"><th>계</th><td></td><td>{won(s.cur)}</td><td></td></tr>
                    {calcRows(s).map((r, i) => <tr key={i} className={r.depth ? "child" : ""}><td>{r.name}</td><td>{r.formula}</td><td>{r.amount}</td><td>{r.note}</td></tr>)}
                  </tbody>
                </table>
              ) : (
                <div className="bp-lines">{calcTextLines(s).map((l, i) => <div key={i} style={{ paddingLeft: 14 + l.depth * 14 }}>{l.text}</div>)}</div>
              )}
            </div>
          );
        })}
        {edit
          ? <div className="bp-req">※ 비고 <div className="dcell"><Txt value={v.notes} placeholder={`※ ${year ?? ""}년도 예산 감액 사유: … (없으면 비워 두세요)`} onChange={(x) => set({ notes: x })} />{old(stale?.notes)}</div></div>
          : v.notes && <pre className="bp-note">{v.notes}</pre>}
      </div>
      {!edit && <p className="bhint"><CheckCircle2 size={12} /> 미리보기는 내용 확인용입니다. 실제 모양은 &lsquo;이 사업만&rsquo;으로 hwpx를 만들어 한글에서 확인해 주세요.</p>}
    </div>
  );
}
