/**
 * 留言板路由
 * GET  /api/messages            → 已回复留言（公开）
 * GET  /api/messages?all=1      → 全部留言（含未回复，管理员 Bearer token）
 * POST /api/messages            → 游客匿名留言（type + content）
 * POST /api/messages/admin/login → 管理员密码校验，返回 token（前端存 sessionStorage）
 * POST /api/messages/:id/reply  → 管理员回复 + 标注打赏金额（Bearer token）
 */
import { Elysia, t } from "elysia";
import type { Message } from "../lib/store.ts";
import { getDb } from "../lib/db.ts";
import { getAdminTokenConfig, issueAdminToken, verifyAdminPassword, verifyAdminToken } from "../lib/admin-auth.ts";

export const MESSAGE_TYPES = ["qa", "feature", "wish", "correction", "other"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

const MAX_CONTENT_LEN = 2000;
const MAX_REPLY_LEN = 2000;
const MAX_TIP = 1_000_000;

/** 从 Authorization 头提取 Bearer token */
function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1].trim() : null;
}

/** 存储层 snake_case → API camelCase（与前端 lib/api.ts 类型对应） */
function toDto(m: Message) {
  return {
    id: m.id,
    type: m.type,
    content: m.content,
    tipAmount: m.tip_amount,
    tipMarkedAt: m.tip_marked_at,
    reply: m.reply,
    repliedAt: m.replied_at,
    createdAt: m.created_at,
  };
}

export const messagesRoutes = new Elysia({ prefix: "/api" })
  .get("/messages", async ({ query, headers, set }) => {
    const store = await getDb();
    const adminEnabled = getAdminTokenConfig() !== null;
    if (query.all === "1") {
      const token = bearerToken((headers as Record<string, string | undefined>).authorization);
      if (!verifyAdminToken(token)) {
        set.status = 401;
        return { error: "UNAUTHORIZED", message: "管理员验证失败，请重新登录" };
      }
      return { messages: (await store.listAllMessages()).map(toDto), adminEnabled: true };
    }
    return { messages: (await store.listRepliedMessages()).map(toDto), adminEnabled };
  })
  .post(
    "/messages",
    async ({ body, set }) => {
      const type = body.type.trim();
      const content = body.content.trim();
      if (!MESSAGE_TYPES.includes(type as MessageType)) {
        set.status = 400;
        return { error: "INVALID_TYPE", message: "留言类型不合法" };
      }
      if (!content) {
        set.status = 400;
        return { error: "EMPTY_CONTENT", message: "留言内容不能为空" };
      }
      if (content.length > MAX_CONTENT_LEN) {
        set.status = 400;
        return { error: "CONTENT_TOO_LONG", message: `留言内容不能超过 ${MAX_CONTENT_LEN} 字` };
      }
      const store = await getDb();
      return toDto(await store.createMessage({ type, content }));
    },
    { body: t.Object({ type: t.String(), content: t.String() }) },
  )
  .post(
    "/messages/admin/login",
    async ({ body, set }) => {
      if (!getAdminTokenConfig()) {
        set.status = 503;
        return { error: "ADMIN_DISABLED", message: "管理员登录未启用：后端未配置 ADMIN_TOKEN，请在 .env 中配置后重启" };
      }
      if (!verifyAdminPassword(body.password)) {
        set.status = 401;
        return { error: "BAD_PASSWORD", message: "密码错误" };
      }
      return { token: issueAdminToken() };
    },
    { body: t.Object({ password: t.String() }) },
  )
  .post(
    "/messages/:id/reply",
    async ({ params, body, headers, set }) => {
      const token = bearerToken((headers as Record<string, string | undefined>).authorization);
      if (!verifyAdminToken(token)) {
        set.status = 401;
        return { error: "UNAUTHORIZED", message: "管理员验证失败，请重新登录" };
      }
      const reply = body.reply.trim();
      if (!reply) {
        set.status = 400;
        return { error: "EMPTY_REPLY", message: "回复内容不能为空" };
      }
      if (reply.length > MAX_REPLY_LEN) {
        set.status = 400;
        return { error: "REPLY_TOO_LONG", message: `回复内容不能超过 ${MAX_REPLY_LEN} 字` };
      }
      if (
        body.tipAmount !== null &&
        (!Number.isFinite(body.tipAmount) || body.tipAmount < 0 || body.tipAmount > MAX_TIP)
      ) {
        set.status = 400;
        return { error: "INVALID_TIP", message: `打赏金额不合法（0 ~ ${MAX_TIP} 元）` };
      }
      const store = await getDb();
      const updated = await store.replyMessage(params.id, reply, body.tipAmount);
      if (!updated) {
        set.status = 404;
        return { error: "NOT_FOUND", message: "留言不存在" };
      }
      return toDto(updated);
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({ reply: t.String(), tipAmount: t.Union([t.Number(), t.Null()]) }),
    },
  );
