/**
 * 存储接口 — 追踪系统的动态状态层（价格快照 + 基本面检测缓存）
 * 调研数据不落库（Markdown 为唯一事实源），数据库只存以下两类状态。
 * 接口统一为异步，兼容 bun:sqlite（同步实现内部包装）与 Turso（HTTP 异步）。
 */

export interface PriceSnapshot {
  thscode: string;
  ts: number;          // 毫秒时间戳
  price: number | null;
  market_cap: number | null;  // 总市值（元）
  pe_ttm: number | null;
  pb_mrq: number | null;
  change_pct: number | null;
}

export interface FundamentalCheck {
  thscode: string;
  last_checked_at: string;        // ISO 时间
  latest_report_title: string;    // 调研截止后出现的最新财报/预告标题
  latest_report_date: string;     // 该公告日期 YYYY-MM-DD
  needs_update: boolean | null;   // true=需更新 / false=无新公告 / null=无法判断
  detail: string;                 // 新公告列表摘要（JSON 字符串）
}

/** 留言（公开匿名提交；type 白名单在路由层校验） */
export interface Message {
  id: number;
  type: string;             // qa/feature/wish/correction/other
  content: string;
  tip_amount: number | null;    // 打赏金额（元），置空则无
  tip_marked_at: string | null; // 打赏标记时间（ISO），与 tip_amount 同步置/清
  reply: string | null;         // 管理员回复，null=未回复
  replied_at: string | null;    // 回复时间（ISO）
  created_at: string;           // 创建时间（ISO）
}

export interface MessageCreateInput {
  type: string;
  content: string;
}

export interface Store {
  /** 追加一条价格快照（自动清理 90 天前的旧数据） */
  saveSnapshot(snap: PriceSnapshot): Promise<void>;
  /** 最近 N 条快照（按时间升序返回） */
  getSnapshots(thscode: string, limit: number): Promise<PriceSnapshot[]>;
  /** 写基本面检测结果 */
  setCheck(check: FundamentalCheck): Promise<void>;
  /** 读基本面检测结果 */
  getCheck(thscode: string): Promise<FundamentalCheck | null>;
  /** 批量读取全部基本面检测结果（列表接口一次取数，避免 N+1 逐公司查询） */
  listChecks(): Promise<FundamentalCheck[]>;
  /** 全部已回复留言（公开展示），按创建时间倒序 */
  listRepliedMessages(): Promise<Message[]>;
  /** 全部留言（含未回复，管理员可见），按创建时间倒序 */
  listAllMessages(): Promise<Message[]>;
  /** 新增留言（公开匿名提交） */
  createMessage(input: MessageCreateInput): Promise<Message>;
  /** 回复留言（管理员）：reply 非空；tipAmount 可空；找不到返回 null */
  replyMessage(id: number, reply: string, tipAmount: number | null): Promise<Message | null>;
  /** 删除留言（管理员）：找到并删除返回 true，不存在返回 false */
  deleteMessage(id: number): Promise<boolean>;
}

/** 留言创建时间倒序比较（ISO 字符串 + id 兜底，保证同毫秒稳定排序） */
function sortByCreatedDesc(a: Message, b: Message): number {
  if (a.created_at !== b.created_at) return b.created_at < a.created_at ? -1 : 1;
  return b.id - a.id;
}

/** 内存降级实现（无 SQLite / 无 Turso 时使用；仅当前进程生命周期） */
export function createMemoryStore(): Store {
  const snaps = new Map<string, PriceSnapshot[]>();
  const checks = new Map<string, FundamentalCheck>();
  const messages: Message[] = [];
  let nextId = 1;
  return {
    async saveSnapshot(snap) {
      const list = snaps.get(snap.thscode) ?? [];
      list.push(snap);
      snaps.set(snap.thscode, list.slice(-500));
    },
    async getSnapshots(thscode, limit) {
      return (snaps.get(thscode) ?? []).slice(-limit);
    },
    async setCheck(check) {
      checks.set(check.thscode, check);
    },
    async getCheck(thscode) {
      return checks.get(thscode) ?? null;
    },
    async listChecks() {
      return [...checks.values()];
    },
    async listRepliedMessages() {
      return messages.filter((m) => m.replied_at !== null).sort(sortByCreatedDesc);
    },
    async listAllMessages() {
      return [...messages].sort(sortByCreatedDesc);
    },
    async createMessage(input) {
      const message: Message = {
        id: nextId++,
        type: input.type,
        content: input.content,
        tip_amount: null,
        tip_marked_at: null,
        reply: null,
        replied_at: null,
        created_at: new Date().toISOString(),
      };
      messages.push(message);
      return message;
    },
    async replyMessage(id, reply, tipAmount) {
      const message = messages.find((m) => m.id === id);
      if (!message) return null;
      const now = new Date().toISOString();
      message.reply = reply;
      message.replied_at = now;
      message.tip_amount = tipAmount;
      message.tip_marked_at = tipAmount === null ? null : now;
      return { ...message };
    },
    async deleteMessage(id) {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx < 0) return false;
      messages.splice(idx, 1);
      return true;
    },
  };
}
