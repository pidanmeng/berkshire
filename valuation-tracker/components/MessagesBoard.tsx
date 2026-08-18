"use client";

import { useCallback, useEffect, useState } from "react";
import { Coffee, Lock, LogOut, MessageSquare, Send, Trash2 } from "lucide-react";
import AppIconRail from "./AppIconRail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Message, MessageType, MessagesResponse } from "@/lib/api";
import { getMessages, createMessage, adminLogin, replyMessage, deleteMessage } from "@/lib/api";

const TOKEN_KEY = "vt-admin-token";

const TYPE_OPTIONS: { key: MessageType; label: string }[] = [
  { key: "qa", label: "Q&A" },
  { key: "feature", label: "网站功能建议" },
  { key: "wish", label: "许愿公司调研" },
  { key: "correction", label: "研报内容纠错" },
  { key: "other", label: "其他" },
];

const TYPE_BADGE: Record<MessageType, string> = {
  qa: "bg-[rgba(242,193,78,0.12)] text-[var(--accent-primary)]",
  feature: "bg-[rgba(52,211,153,0.12)] text-[var(--accent-success)]",
  wish: "bg-[rgba(251,191,36,0.12)] text-[var(--accent-warning)]",
  correction: "bg-[rgba(238,0,0,0.12)] text-[var(--accent-danger)]",
  other: "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 留言输入框附近的打赏引导（与「请我喝杯咖啡」同款图片与文案） */
function DonateGuide() {
  return (
    <div className="border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4">
      <p className="flex items-center gap-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
        <Coffee className="size-3.5 shrink-0 text-[var(--accent-primary)]" />
        每次调研一只股票需要花费约
        <b className="text-[var(--accent-primary)]">3 元 Token</b>
        ；网站目前服务器、域名均为自费运营。
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <figure className="flex flex-col items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/donate/wechat-pay.png"
            alt="微信收款码"
            className="w-40 border border-[var(--border-subtle)] object-contain sm:w-50"
          />
          <figcaption className="text-[11px] text-[var(--text-muted)]">微信收款码</figcaption>
        </figure>
        <figure className="flex flex-col items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/donate/wechat-friend.png"
            alt="微信添加好友二维码"
            className="w-40 border border-[var(--border-subtle)] object-contain sm:w-50"
          />
          <figcaption className="text-[11px] text-[var(--text-muted)]">微信添加好友</figcaption>
        </figure>
      </div>
      <p className="mt-3 text-center text-xs leading-relaxed text-[var(--text-secondary)]">
        打赏
        <b className="mx-1 text-[var(--accent-warning)]">3 元以上</b>
        ，备注
        <b className="mx-1">股票代码或股票名称</b>
        ，我看到后会启动调研流程。
      </p>
    </div>
  );
}

/** 单条留言卡片（管理员模式下额外提供回复 + 打赏标注 + 删除） */
function MessageItem({
  msg,
  admin,
  token,
  onReplied,
  onDeleted,
}: {
  msg: Message;
  admin: boolean;
  token: string | null;
  onReplied: (updated: Message) => void;
  onDeleted: (id: number) => void;
}) {
  const [replyDraft, setReplyDraft] = useState(msg.reply ?? "");
  const [tipDraft, setTipDraft] = useState(msg.tipAmount !== null ? String(msg.tipAmount) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    const reply = replyDraft.trim();
    if (!reply) {
      setSaveError("回复内容不能为空");
      return;
    }
    let tip: number | null = null;
    if (tipDraft.trim() !== "") {
      const n = Number(tipDraft);
      if (!Number.isFinite(n) || n < 0) {
        setSaveError("打赏金额格式不正确");
        return;
      }
      tip = n;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await replyMessage(msg.id, reply, tip, token ?? "");
      onReplied(updated);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`确定删除这条留言吗？（id=${msg.id}）`)) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await deleteMessage(msg.id, token ?? "");
      onDeleted(msg.id);
    } catch (e) {
      setSaveError((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <article className="border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("px-2 py-0.5 text-[11px] font-semibold", TYPE_BADGE[msg.type])}>
          {TYPE_OPTIONS.find((t) => t.key === msg.type)?.label ?? msg.type}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-muted)]">{fmtTime(msg.createdAt)}</span>
        {msg.tipAmount !== null && (
          <span className="bg-[rgba(242,193,78,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-primary)]">
            已打赏 ¥{msg.tipAmount}
          </span>
        )}
        {admin && (
          <span
            className={cn(
              "px-2 py-0.5 text-[11px] font-semibold",
              msg.reply === null
                ? "bg-[rgba(251,191,36,0.12)] text-[var(--accent-warning)]"
                : "bg-[rgba(52,211,153,0.12)] text-[var(--accent-success)]",
            )}
          >
            {msg.reply === null ? "待回复" : "已回复"}
          </span>
        )}
        {admin && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="ml-auto"
            onClick={handleDelete}
            disabled={deleting}
            title="删除留言"
          >
            <Trash2 className="size-3.5" />
            {deleting ? "删除中…" : "删除"}
          </Button>
        )}
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{msg.content}</p>

      {msg.reply !== null && (
        <div className="mt-3 border-l-2 border-[var(--accent-primary)] bg-[var(--bg-elevated)] px-3 py-2">
          <div className="text-[11px] font-semibold text-[var(--accent-primary)]">我的回复</div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">{msg.reply}</p>
        </div>
      )}

      {admin && (
        <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3">
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder="回复内容…"
            rows={2}
            className="h-auto min-h-16 w-full resize-y border border-[var(--border-default)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-[border-color,box-shadow] focus-visible:border-[var(--accent-primary)] focus-visible:ring-[3px] focus-visible:ring-[rgba(242,193,78,0.25)]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={tipDraft}
              onChange={(e) => setTipDraft(e.target.value)}
              placeholder="打赏金额（元），如 5"
              className="h-8 w-44"
            />
            <Button type="button" size="sm" variant="outline" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存回复与打赏"}
            </Button>
            {saveError && <span className="text-xs text-[var(--accent-danger)]">{saveError}</span>}
          </div>
        </div>
      )}
    </article>
  );
}

/** 留言板：游客提交留言 / 已回复留言公开展示 / 管理员登录后可见全部并可回复与标注打赏 */
export default function MessagesBoard({ initial }: { initial: MessagesResponse | null }) {
  const [messages, setMessages] = useState<Message[]>(initial?.messages ?? []);
  const [adminEnabled, setAdminEnabled] = useState(initial?.adminEnabled ?? false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [type, setType] = useState<MessageType>("qa");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 恢复管理员会话（sessionStorage 中的 token 有效则直接进入管理员视图）
  useEffect(() => {
    let t: string | null = null;
    try {
      t = window.sessionStorage.getItem(TOKEN_KEY);
    } catch {
      // 存储不可用视为未登录
    }
    if (!t) return;
    getMessages(true, t)
      .then((res) => {
        setIsAdmin(true);
        setToken(t);
        setAdminEnabled(res.adminEnabled);
        setMessages(res.messages);
      })
      .catch(() => {
        try {
          window.sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          // ignore
        }
        setRefreshError("管理员会话已失效，请重新登录");
      });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const { token: t } = await adminLogin(password);
      try {
        window.sessionStorage.setItem(TOKEN_KEY, t);
      } catch {
        // 存储不可用时仅本次会话有效
      }
      setToken(t);
      setIsAdmin(true);
      setPassword("");
      setLoginOpen(false);
      const res = await getMessages(true, t);
      setMessages(res.messages);
      setAdminEnabled(res.adminEnabled);
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
    setToken(null);
    setIsAdmin(false);
    setLoginOpen(false);
    setRefreshError(null);
    getMessages()
      .then((res) => {
        setMessages(res.messages);
        setAdminEnabled(res.adminEnabled);
      })
      .catch(() => {
        // 恢复公共视图失败，保留现有列表
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setSubmitMsg({ ok: false, text: "请填写留言内容" });
      return;
    }
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const created = await createMessage({ type, content });
      setContent("");
      setSubmitMsg({ ok: true, text: "留言提交成功，回复后会展示在这里" });
      // 管理员在线时新留言立即可见（未回复状态）
      if (isAdmin) setMessages((prev) => [created, ...prev]);
    } catch (err) {
      setSubmitMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReplied = useCallback((updated: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  const handleDeleted = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return (
    <div className="flex h-dvh min-w-0 w-full overflow-hidden">
      <AppIconRail className="h-full" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 页头 */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
              <MessageSquare className="size-5 text-[var(--accent-primary)]" />
              留言板
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Q&A · 网站功能建议 · 许愿公司调研 · 研报内容纠错
            </p>
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--accent-success)]">
                <span className="size-1.5 rounded-full bg-[var(--accent-success)]" />
                管理员模式
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="size-3.5" />
                退出登录
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoginOpen((v) => !v);
                setLoginError(null);
              }}
            >
              <Lock className="size-3.5" />
              管理员登录
            </Button>
          )}
        </header>

        {/* 管理员登录表单（内联折叠） */}
        {loginOpen && !isAdmin && (
          <form
            onSubmit={handleLogin}
            className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-3"
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="管理员密码"
              className="h-8 w-56"
              autoFocus
            />
            <Button type="submit" size="sm" disabled={loggingIn}>
              {loggingIn ? "校验中…" : "登录"}
            </Button>
            {!adminEnabled && (
              <span className="text-xs text-[var(--accent-warning)]">管理员功能未启用：后端未配置 ADMIN_TOKEN</span>
            )}
            {loginError && <span className="text-xs text-[var(--accent-danger)]">{loginError}</span>}
          </form>
        )}

        {/* 会话失效提示 */}
        {refreshError && (
          <div className="border-b border-[var(--border-subtle)] bg-[rgba(238,0,0,0.08)] px-5 py-2 text-xs text-[var(--accent-danger)]">
            {refreshError}
          </div>
        )}

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {/* 发布留言 */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)]">发布留言</h2>
              <form
                onSubmit={handleSubmit}
                className="space-y-3 border border-[var(--border-default)] bg-[var(--bg-card)] p-4"
              >
                <div className="flex flex-wrap gap-2">
                  {TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setType(opt.key)}
                      className={cn(
                        "border px-3 py-1.5 text-xs transition-colors",
                        type === opt.key
                          ? "border-[var(--accent-primary)] bg-[rgba(242,193,78,0.15)] font-semibold text-[var(--accent-primary)]"
                          : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="写下你的问题或建议…（提交后仅我可见，回复后会展示在这里）"
                  rows={4}
                  className="h-auto min-h-24 w-full resize-y border border-[var(--border-default)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-[border-color,box-shadow] focus-visible:border-[var(--accent-primary)] focus-visible:ring-[3px] focus-visible:ring-[rgba(242,193,78,0.25)]"
                />
                <DonateGuide />
                <div className="flex items-center gap-3">
                  <Button type="submit" size="sm" disabled={submitting}>
                    <Send className="size-3.5" />
                    {submitting ? "提交中…" : "提交留言"}
                  </Button>
                  {submitMsg && (
                    <span className={cn("text-xs", submitMsg.ok ? "text-[var(--accent-success)]" : "text-[var(--accent-danger)]")}>
                      {submitMsg.text}
                    </span>
                  )}
                </div>
              </form>
            </section>

            {/* 留言列表 */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-[var(--text-secondary)]">
                {isAdmin ? "全部留言（含未回复）" : "已回复留言"}
              </h2>
              {messages.length === 0 ? (
                <div className="border border-dashed border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                  {isAdmin ? "暂无留言" : "还没有已回复的留言，欢迎留言提问，回复后会展示在这里"}
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <MessageItem key={m.id} msg={m} admin={isAdmin} token={token} onReplied={handleReplied} onDeleted={handleDeleted} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
