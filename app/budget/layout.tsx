import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "세부사업설명서 도우미",
  description: "세출예산사업명세서 PDF로 세부사업설명서 내용을 채웁니다. 파일은 브라우저 안에서만 처리됩니다.",
};

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
