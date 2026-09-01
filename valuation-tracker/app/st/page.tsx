import StDashboard from "@/components/StDashboard";
import { getStList } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function StPage() {
  let initial: Awaited<ReturnType<typeof getStList>> | null = null;
  let apiError: string | null = null;
  try {
    initial = await getStList();
  } catch {
    initial = null;
    apiError = "Elysia 后端不可达（请先启动 bun run dev）";
  }

  return (
    <div className="page-wrapper page-wrapper-wide">
      {apiError && (
        <div className="status-bar" style={{ padding: "12px 24px" }}>
          <span className="dot err" />
          <span style={{ color: "var(--accent-danger)" }}>{apiError}</span>
        </div>
      )}
      <StDashboard initial={initial} />
    </div>
  );
}
