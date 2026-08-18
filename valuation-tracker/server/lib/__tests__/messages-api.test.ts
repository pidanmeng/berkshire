/**
 * 留言板 API 冒烟测试 — 进程内 app.handle() 全链路（登录/留言/回复/打赏/公开可见性）
 * 关键：beforeAll 先 chdir 到临时目录，db.ts 惰性解析 cwd，首次 getDb() 落在临时目录，
 * 不触碰正式库 data/tracker.db。运行：bun test valuation-tracker/server/lib/__tests__/messages-api.test.ts
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { chdir } from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { app } from "../../app.ts";

let tempDir: string;
const prevCwd = process.cwd();
const prevToken = process.env.ADMIN_TOKEN;
const prevTursoUrl = process.env.TURSO_URL;
const prevTursoAuth = process.env.TURSO_AUTH_TOKEN;

function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
  );
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "messages-api-test-"));
  process.chdir(tempDir);
  process.env.ADMIN_TOKEN = "test-admin";
  // 隔离测试环境：清除 TURSO 配置，避免测试写入真实远程库（与 ADMIN_TOKEN 同策略）
  delete process.env.TURSO_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

afterAll(async () => {
  process.chdir(prevCwd);
  if (prevToken === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = prevToken;
  if (prevTursoUrl === undefined) delete process.env.TURSO_URL;
  else process.env.TURSO_URL = prevTursoUrl;
  if (prevTursoAuth === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = prevTursoAuth;
  // Windows 句柄释放有延迟，rmSync 可能瞬时 EBUSY，重试直至成功
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

async function login(): Promise<string> {
  const res = await call("POST", "/api/messages/admin/login", { body: { password: "test-admin" } });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { token: string };
  return data.token;
}

describe("留言板 API", () => {
  test("公开列表初始为空，adminEnabled 反映 ADMIN_TOKEN 配置", async () => {
    const res = await call("GET", "/api/messages");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { messages: unknown[]; adminEnabled: boolean };
    expect(Array.isArray(data.messages)).toBe(true);
    expect(data.messages).toHaveLength(0);
    expect(data.adminEnabled).toBe(true);
  });

  test("游客创建留言：未回复前公开列表不可见", async () => {
    const created = await call("POST", "/api/messages", { body: { type: "qa", content: "请问如何看估值？" } });
    expect(created.status).toBe(200);
    const msg = (await created.json()) as { id: number; type: string; reply: null };
    expect(msg.id).toBeGreaterThan(0);
    expect(msg.type).toBe("qa");
    expect(msg.reply).toBeNull();

    const pub = (await (await call("GET", "/api/messages")).json()) as { messages: { id: number }[] };
    expect(pub.messages.find((m) => m.id === msg.id)).toBeUndefined();
  });

  test("非法类型与空内容被拒绝（400）", async () => {
    const badType = await call("POST", "/api/messages", { body: { type: "spam", content: "x" } });
    expect(badType.status).toBe(400);
    const empty = await call("POST", "/api/messages", { body: { type: "qa", content: "   " } });
    expect(empty.status).toBe(400);
  });

  test("管理员登录：错误密码 401，正确密码返回 token", async () => {
    const bad = await call("POST", "/api/messages/admin/login", { body: { password: "wrong" } });
    expect(bad.status).toBe(401);
    const token = await login();
    expect(token).toBeTruthy();
  });

  test("全部留言接口：无 token 401，带 token 200 且含未回复留言", async () => {
    const noAuth = await call("GET", "/api/messages?all=1");
    expect(noAuth.status).toBe(401);

    const token = await login();
    const res = await call("GET", "/api/messages?all=1", { token });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { messages: { reply: string | null }[] };
    expect(data.messages.length).toBeGreaterThan(0);
    expect(data.messages.some((m) => m.reply === null)).toBe(true); // 含未回复
  });

  test("管理员回复 + 标注打赏：公开列表可见回复与打赏", async () => {
    const created = (await (await call("POST", "/api/messages", { body: { type: "wish", content: "许愿调研腾讯" } })).json()) as { id: number };
    const token = await login();
    const replied = await call("POST", `/api/messages/${created.id}/reply`, {
      body: { reply: "已安排调研", tipAmount: 5 },
      token,
    });
    expect(replied.status).toBe(200);
    const updated = (await replied.json()) as { reply: string; tipAmount: number; tipMarkedAt: string };
    expect(updated.reply).toBe("已安排调研");
    expect(updated.tipAmount).toBe(5);
    expect(updated.tipMarkedAt).toBeTruthy();

    const pub = (await (await call("GET", "/api/messages")).json()) as { messages: { id: number; reply: string; tipAmount: number }[] };
    const found = pub.messages.find((m) => m.id === created.id);
    expect(found).toBeDefined();
    expect(found!.reply).toBe("已安排调研");
    expect(found!.tipAmount).toBe(5);
  });

  test("回复不存在的留言返回 404；非法打赏金额返回 400", async () => {
    const token = await login();
    const notFound = await call("POST", "/api/messages/999999/reply", { body: { reply: "x", tipAmount: null }, token });
    expect(notFound.status).toBe(404);

    const created = (await (await call("POST", "/api/messages", { body: { type: "other", content: "测试" } })).json()) as { id: number };
    const badTip = await call("POST", `/api/messages/${created.id}/reply`, { body: { reply: "x", tipAmount: -1 }, token });
    expect(badTip.status).toBe(400);
  });

  test("未配置 ADMIN_TOKEN 时登录返回明确提示（503）", async () => {
    delete process.env.ADMIN_TOKEN;
    try {
      const res = await call("POST", "/api/messages/admin/login", { body: { password: "anything" } });
      expect(res.status).toBe(503);
      const data = (await res.json()) as { message: string };
      expect(data.message).toContain("ADMIN_TOKEN");
    } finally {
      process.env.ADMIN_TOKEN = "test-admin";
    }
  });
});
