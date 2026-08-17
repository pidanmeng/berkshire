import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "估值追踪系统",
  description: "基于投研 Agent 产出的市值监控终端",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
