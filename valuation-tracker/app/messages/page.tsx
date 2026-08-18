import MessagesBoard from "@/components/MessagesBoard";
import { getMessages } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  let initial: Awaited<ReturnType<typeof getMessages>> | null = null;
  let apiError: string | null = null;
  try {
    initial = await getMessages();
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
      <MessagesBoard initial={initial} />
    </div>
  );
}
