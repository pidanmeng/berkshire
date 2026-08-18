/**
 * 暗盘追踪列表页（独立页）— 服务端取当日全市场暗盘数据，渲染复用客户端组件 DarkTradeDashboard
 * 数据由后端 /api/darktrade 提供（东财上游经 Elysia 脱敏转发，浏览器不直连）。
 */
import DarkTradeDashboard from "@/components/DarkTradeDashboard";
import { getDarkTradeList, type DarkTradeListResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DarkTradePage() {
  let initial: DarkTradeListResponse | null = null;
  let apiError: string | null = null;
  try {
    initial = await getDarkTradeList();
  } catch {
    apiError = "暗盘数据获取失败（Elysia 后端不可达或上游无数据）";
  }

  return (
    <div className="page-wrapper page-wrapper-wide">
      {apiError && (
        <div className="status-bar" style={{ padding: "12px 24px" }}>
          <span className="dot err" />
          <span style={{ color: "var(--accent-danger)" }}>{apiError}</span>
        </div>
      )}
      <DarkTradeDashboard initial={initial} />
    </div>
  );
}
