import BacktestDashboard from "@/components/BacktestDashboard";
import { getBacktest } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function BacktestPage() {
  let initial: Awaited<ReturnType<typeof getBacktest>> | null = null;
  let apiError: string | null = null;
  let dataError: string | null = null;
  try {
    initial = await getBacktest();
    if (initial && "error" in initial) {
      dataError = (initial as { message?: string }).message ?? "回测数据缺失";
      initial = null;
    }
  } catch {
    initial = null;
    apiError = "Elysia 后端不可达（请先启动 bun run dev）";
  }

  return (
    <div className="page-wrapper page-wrapper-wide">
      {(apiError || dataError) && (
        <div className="status-bar" style={{ padding: "12px 24px" }}>
          <span className="dot err" />
          <span style={{ color: "var(--accent-danger)" }}>{apiError ?? dataError}</span>
        </div>
      )}
      <BacktestDashboard initial={initial} />
    </div>
  );
}
