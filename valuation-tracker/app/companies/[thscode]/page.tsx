/**
 * 公司详情页（独立页）— 服务端取初始数据，渲染复用组件 CompanyDashboard
 * 数据由后端 /api/companies/:thscode 提供；K 线与详情刷新在客户端完成。
 */
import { notFound } from "next/navigation";
import { getCompanyDetail, type CompanyDetail } from "@/lib/api";
import CompanyDashboard from "@/components/CompanyDashboard";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ thscode: string }> }) {
  const { thscode } = await params;
  const code = thscode.toUpperCase();

  let detail: CompanyDetail | null = null;
  let apiError: string | null = null;
  try {
    detail = await getCompanyDetail(code);
  } catch {
    apiError = "Elysia 后端不可达（请先启动 bun run dev）";
  }
  // notFound 必须在 try/catch 之外抛出，否则会被当作 API 错误吞掉
  if (detail && "error" in (detail as unknown as Record<string, unknown>)) {
    notFound();
  }
  if (!detail && !apiError) notFound();

  return (
    <div className="page-wrapper">
      <header className="topbar flex-wrap gap-2">
        <div>
          <a className="back-link" href="/">← 返回看板</a>
          <div className="sub" style={{ marginTop: 6 }}>估值追踪系统 · 公司详情</div>
        </div>
        <a href="http://localhost:3001/api/health" target="_blank" rel="noreferrer">API 状态 ↗</a>
      </header>
      {apiError ? (
        <div className="status-bar"><span className="dot err" /><span style={{ color: "var(--accent-danger)" }}>{apiError}</span></div>
      ) : detail ? (
        <CompanyDashboard thscode={code} initial={detail} />
      ) : null}
      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: 12 }}>
        数据仅供研究参考，不构成投资建议。
      </footer>
    </div>
  );
}
