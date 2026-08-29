/**
 * 公司详情页（独立页）— SSG：generateStaticParams 由静态 JSON 生成，
 * 初始详情注入 CompanyDashboard；笔记正文/文档正文/K线/实时行情在客户端按需加载。
 */
import { notFound } from "next/navigation";
import type { CompanyStaticDetail } from "@/lib/api";
import { getStaticNote, getStaticDocs, listStaticCodes } from "@/lib/static-data";
import CompanyDashboard from "@/components/CompanyDashboard";

export function generateStaticParams() {
  return listStaticCodes().map((thscode) => ({ thscode }));
}

export default async function CompanyPage({ params }: { params: Promise<{ thscode: string }> }) {
  const { thscode } = await params;
  const code = thscode.toUpperCase();

  const note = getStaticNote(code);
  if (!note) notFound();
  const docs = getStaticDocs(code);
  const initial: CompanyStaticDetail = {
    note,
    docs: { deepReads: docs?.deepReads ?? [], annualReports: docs?.annualReports ?? [] },
    updates: docs?.updates ?? [],
  };

  return (
    <div className="page-wrapper">
      <header className="topbar flex-wrap gap-2">
        <div>
          <a className="back-link" href="/">← 返回看板</a>
          <div className="sub" style={{ marginTop: 6 }}>估值追踪系统 · 公司详情</div>
        </div>
        <a href="http://localhost:3001/api/health" target="_blank" rel="noreferrer">API 状态 ↗</a>
      </header>
      <CompanyDashboard thscode={code} initial={initial} />
      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: 12 }}>
        数据仅供研究参考，不构成投资建议。
      </footer>
    </div>
  );
}
