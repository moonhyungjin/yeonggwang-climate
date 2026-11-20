// 브라우저에서 파일 읽기 (서버로 보내지 않음)
import { parseHwpxLines, sectionXmlToLines, type ImportedProject } from "./hwpxImport";
import { parseBudgetRows, toRows, type Glyph } from "./parsePdf";
import type { BudgetDoc } from "./types";
import { extractTemplate, previewText, renderSection, type ExportItem } from "./hwpxExport";

// public/pdf.worker.min.js 는 node_modules/pdfjs-dist/build 에서 복사한 것 (pdfjs-dist 버전과 같아야 함)
const WORKER_SRC = "/pdf.worker.min.js";

export async function readBudgetPdf(file: File): Promise<BudgetDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: Glyph[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.flatMap((it: any) => ("str" in it ? [{ x: it.transform[4], y: it.transform[5], w: it.width, s: it.str }] : [])));
  }
  const parsed = parseBudgetRows(toRows(pages));
  if (!parsed.projects.length) throw new Error("세부사업을 찾지 못했습니다. e-호조의 '세출예산사업명세서' PDF인지 확인해 주세요.");
  return parsed;
}

export async function readDescriptionHwpx(file: File): Promise<ImportedProject[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sections = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!sections.length) throw new Error("hwpx 본문을 찾지 못했습니다. 한글(.hwpx) 파일인지 확인해 주세요.");
  const lines: string[] = [];
  for (const s of sections) lines.push(...sectionXmlToLines(await zip.file(s)!.async("string")));
  const projects = parseHwpxLines(lines);
  if (!projects.length) throw new Error("세부사업설명서 형식(조직·세부사업 표)을 찾지 못했습니다.");
  return projects;
}

/** 서식 hwpx의 본문 section XML들 (번호 순) */
async function sectionsOf(zip: any): Promise<string[]> {
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return Promise.all(names.map((n) => zip.file(n)!.async("string")));
}

const NO_DIR = { createFolders: false } as const; // 원본처럼 폴더 항목 없이

/** 서식 hwpx(기존 설명서)의 모양으로 새 세부사업설명서 hwpx 만들기 */
export async function buildDescriptionHwpx(template: File, items: ExportItem[], year: number): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const src = await JSZip.loadAsync(await template.arrayBuffer());
  const tpl = extractTemplate(await sectionsOf(src));
  const section = renderSection(tpl, items, year);

  const out = new JSZip();
  out.file("mimetype", "application/hwp+zip", { compression: "STORE" }); // 반드시 첫 파일, 무압축
  for (const name of Object.keys(src.files)) {
    const f = src.files[name];
    if (f.dir || name === "mimetype") continue;
    if (/^Contents\/section\d+\.xml$/.test(name) || /^BinData\//.test(name) || /^Preview\/PrvImage/.test(name)) continue; // 본문·그림은 새로
    if (name === "Contents/content.hpf") {
      const hpf = (await f.async("string"))
        .replace(/<opf:item id="(?!section0")section\d+"[^>]*\/>/g, "")
        .replace(/<opf:item [^>]*href="BinData\/[^"]*"[^>]*\/>/g, "")
        .replace(/<opf:item [^>]*href="Preview\/PrvImage[^"]*"[^>]*\/>/g, "")
        .replace(/<opf:itemref idref="(?!section0")section\d+"[^>]*\/>/g, "")
        .replace(/<opf:title>[^<]*<\/opf:title>/, "<opf:title>세부사업설명서</opf:title>");
      out.file(name, hpf, NO_DIR);
    } else if (name === "Contents/header.xml") {
      out.file(name, (await f.async("string")).replace(/(<hh:head\b[^>]*\bsecCnt=")\d+/, "$11"), NO_DIR);
    } else if (name === "Preview/PrvText.txt") {
      out.file(name, previewText(items), NO_DIR);
    } else {
      out.file(name, await f.async("uint8array"), NO_DIR);
    }
  }
  out.file("Contents/section0.xml", section, NO_DIR);
  return out.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/hwp+zip" });
}
