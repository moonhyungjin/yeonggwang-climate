import "./globals.css";
import type { Metadata } from "next";
import TopNav from "./components/TopNav";

export const metadata: Metadata = { title: "영광 기후 리포트", description: "영광군의 실제 기상 관측과 평년 기후값 비교" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
