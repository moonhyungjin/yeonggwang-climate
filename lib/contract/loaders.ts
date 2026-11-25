// 계약서 도우미: 브라우저에서 파일 읽기·만들기 (서버로 보내지 않음)
import { fillContract, readTemplate, type ContractData, type TemplateInfo } from "./fill";
import { toRows, type Row } from "./parsePdfs";

const WORKER_SRC = "/pdf.worker.min.js"; // public/ (pdfjs-dist 버전과 같아야 함)

/** PDF 글자를 쪽마다 줄로 묶어 이어 붙인 목록 */
export async function readPdfRows(file: File): Promise<Row[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const rows: Row[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    rows.push(...toRows(tc.items.flatMap((it: any) => ("str" in it ? [{ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }] : []))));
  }
  if (!rows.length) throw new Error("PDF에서 글자를 찾지 못했습니다. 스캔한 이미지 PDF는 읽을 수 없습니다.");
  return rows;
}

async function openHwpx(file: { arrayBuffer(): Promise<ArrayBuffer> }) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!names.length) throw new Error("hwpx 본문을 찾지 못했습니다. 한글(.hwpx) 파일인지 확인해 주세요.");
  const sections = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  return { JSZip, zip, names, sections };
}

/** 서식 hwpx에서 기존 값 찾기 */
export async function readContractTemplate(file: File): Promise<TemplateInfo> {
  const { sections } = await openHwpx(file);
  const info = readTemplate(sections);
  if (!info.found.name && !info.found.company) throw new Error("계약서 서식에서 계약명·상호 칸을 찾지 못했습니다.");
  return info;
}

const NO_DIR = { createFolders: false } as const;

/** 서식 hwpx의 값을 새 값으로 바꾼 계약서 hwpx */
export async function buildContractHwpx(template: { arrayBuffer(): Promise<ArrayBuffer> }, data: ContractData) {
  const { JSZip, zip, names, sections } = await openHwpx(template);
  const { sections: filled, changes } = fillContract(sections, data);
  const out = new JSZip();
  out.file("mimetype", "application/hwp+zip", { compression: "STORE" }); // 반드시 첫 파일, 무압축
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (f.dir || name === "mimetype" || /^Preview\/PrvImage/.test(name)) continue; // 미리보기 그림은 옛 내용이라 뺀다
    const si = names.indexOf(name);
    if (si >= 0) out.file(name, filled[si], NO_DIR);
    else if (name === "Preview/PrvText.txt") {
      let t = await f.async("string");
      for (const c of changes) if (c.from && c.to && !c.from.includes("\n")) t = t.split(c.from.trim()).join(c.to.trim());
      out.file(name, t, NO_DIR);
    } else out.file(name, await f.async("uint8array"), NO_DIR);
  }
  const blob = await out.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/hwp+zip" });
  return { blob, changes };
}
