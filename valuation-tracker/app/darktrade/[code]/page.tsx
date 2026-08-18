/**
 * 单股暗盘历史详情页 — 服务端取历史数据（利用 SQLite 页码 hint 加速，页码变化由后端检测并写回）
 * 数据由后端 /api/darktrade/history/:code 提供；可通过 ?endDate=yyyyMMdd&startDate=yyyyMMdd 自定义范围。
 */
import { notFound } from "next/navigation";
import { getDarkTradeHistory, type DarkTradeHistoryResponse } from "@/lib/api";
import DarkTradeHistory from "@/components/DarkTradeHistory";
import AppIconRail from "@/components/AppIconRail";

export const dynamic = "force-dynamic";

export default async function DarkTradeHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ endDate?: string; startDate?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;

  let initial: DarkTradeHistoryResponse | null = null;
  let apiError: string | null = null;
  try {
    initial = await getDarkTradeHistory(code, {
      endDate: sp.endDate || undefined,
      startDate: sp.startDate || undefined,
    });
  } catch {
    apiError = "暗盘历史获取失败（Elysia 后端不可达或上游无数据）";
  }
  if (!initial && !apiError) notFound();

  return (
    <div className="flex h-dvh min-w-0 w-full overflow-hidden">
      {/* ===== 最左侧页面导航 ICON 列 ===== */}
      <AppIconRail className="h-full" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="page-wrapper">
          <header className="topbar">
            <div>
              <a className="back-link" href="/darktrade">← 返回暗盘列表</a>
              <div className="sub" style={{ marginTop: 6 }}>估值追踪系统 · 暗盘追踪 · 单股历史</div>
            </div>
            <a href="http://localhost:3001/api/health" target="_blank" rel="noreferrer">API 状态 ↗</a>
          </header>
          {apiError ? (
            <div className="status-bar"><span className="dot err" /><span style={{ color: "var(--accent-danger)" }}>{apiError}</span></div>
          ) : (
            <DarkTradeHistory code={code} initial={initial} />
          )}
          <footer style={{ marginTop: 40, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", color: "var(--text-muted)", fontSize: 12 }}>
            数据仅供研究参考，不构成投资建议。
          </footer>
        </div>
      </div>
    </div>
  );
}
