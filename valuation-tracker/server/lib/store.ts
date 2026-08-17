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

export interface Store {
  /** 追加一条价格快照（自动清理 90 天前的旧数据） */
  saveSnapshot(snap: PriceSnapshot): Promise<void>;
  /** 最近 N 条快照（按时间升序返回） */
  getSnapshots(thscode: string, limit: number): Promise<PriceSnapshot[]>;
  /** 写基本面检测结果 */
  setCheck(check: FundamentalCheck): Promise<void>;
  /** 读基本面检测结果 */
  getCheck(thscode: string): Promise<FundamentalCheck | null>;
}

/** 内存降级实现（无 SQLite / 无 Turso 时使用；仅当前进程生命周期） */
export function createMemoryStore(): Store {
  const snaps = new Map<string, PriceSnapshot[]>();
  const checks = new Map<string, FundamentalCheck>();
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
  };
}
