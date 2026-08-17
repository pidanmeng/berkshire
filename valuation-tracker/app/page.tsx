import Dashboard from "@/components/Dashboard";
import { getCompanies } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let initial: { list: never[]; fetchedAt: number } | Awaited<ReturnType<typeof getCompanies>>;
  let apiError: string | null = null;
  try {
    initial = await getCompanies();
  } catch {
    initial = { list: [], fetchedAt: 0 };
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
      <Dashboard initial={initial} />
    </div>
  );
}
