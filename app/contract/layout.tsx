import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "계약서 도우미",
  description: "결재문서·사업자등록증 PDF로 표준계약서 hwpx를 채웁니다. 파일은 브라우저 안에서만 처리됩니다.",
};

export default function ContractLayout({ children }: { children: React.ReactNode }) {
  return children;
}
