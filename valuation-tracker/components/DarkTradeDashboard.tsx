"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Loader2, RefreshCw, Search, Star } from "lucide-react";
import type { DarkTradeListResponse, DarkTradeRow } from "@/lib/api";
import { getDarkTradeList } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AppIconRail from "./AppIconRail";
import { useFavorites } from "@/hooks/use-favorites";
import { codeToThscode, cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type SortKey = "code" | "name" | "darkFund" | "brightFund" | "mainNet" | "activity" | "price" | "changePct";
type SortDir = "asc" | "desc";

const SORT_COLS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "code", label: "代码" },
  { key: "name", label: "名称" },
  { key: "darkFund", label: "暗盘资金", align: "right" },
  { key: "brightFund", label: "明盘资金", align: "right" },
  { key: "mainNet", label: "主力净流入", align: "right" },
  { key: "activity", label: "活跃度", align: "right" },
  { key: "price", label: "股价(元)", align: "right" },
  { key: "changePct", label: "涨幅", align: "right" },
];

/** 金额格式化（元 → 亿/万） */
function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return `${v.toFixed(2)}元`;
}

/** A 股红涨绿跌：正数红色，负数绿色 */
const signColor = (v: number) => (v > 0 ? "var(--fin-up)" : v < 0 ? "var(--fin-down)" : "var(--fin-flat)");

export default function DarkTradeDashboard({ initial }: { initial: DarkTradeListResponse | null }) {
  const [list, setList] = useState<DarkTradeListResponse | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(initial?.actualDate ?? "");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("changePct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const { favoriteSet, toggleFavorite } = useFavorites();

  const load = useCallback(async (dateStr?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDarkTradeList(dateStr);
      setList(data);
      setDate(data.actualDate);
      setPage(1);
    } catch {
      setError("数据加载失败（后端不可达或上游无当日数据）");
    } finally {
      setLoading(false);
    }
  }, []);

  // 搜索 + 自选过滤 + 排序（全量前端过滤）
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let rows = list?.items ?? [];
    if (watchlistOnly) rows = rows.filter((r) => favoriteSet.has(codeToThscode(r.code)));
    if (kw) rows = rows.filter((r) => r.name.toLowerCase().includes(kw) || r.code.includes(kw));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv, "zh-CN") * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [list, q, watchlistOnly, favoriteSet, sortKey, sortDir]);

  // 当日列表中的自选数（用于「只看自选」开关计数）
  const favCount = useMemo(
    () => (list?.items ?? []).filter((r) => favoriteSet.has(codeToThscode(r.code))).length,
    [list, favoriteSet],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const stats = useMemo(() => {
    const rows = list?.items ?? [];
    const inflow = rows.filter((r) => r.darkFund > 0);
    const outflow = rows.filter((r) => r.darkFund < 0);
    return {
      total: rows.length,
      inflowCount: inflow.length,
      outflowCount: outflow.length,
      inflowAmount: inflow.reduce((s, r) => s + r.darkFund, 0),
      outflowAmount: outflow.reduce((s, r) => s + r.darkFund, 0),
    };
  }, [list]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const todayInput = date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";

  return (
    <div className="flex h-dvh min-w-0 w-full overflow-hidden">
      {/* ===== 最左侧页面导航 ICON 列 ===== */}
      <AppIconRail className="h-full" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">暗盘追踪</h1>
          <div className="mt-1 text-xs text-[var(--text-muted)]">
            全市场暗盘资金监控 · 数据经后端代理（东财）· 红涨绿跌 · 点击名称查看个股历史
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={todayInput}
            onChange={(e) => setDate(e.target.value.replaceAll("-", ""))}
            className="h-8 w-40 text-xs"
            aria-label="查询日期"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => load(date || undefined)}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            查询
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <div className="status-bar">
            <span className="dot err" />
            <span style={{ color: "var(--accent-danger)" }}>{error}</span>
          </div>
        )}

        {/* 统计摘要 */}
        {list && (
          <section className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3 text-sm">
            <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <Activity className="size-4" style={{ color: "var(--accent-primary)" }} />
              交易日：
              <span className="font-bold text-[var(--text-primary)]">
                {date.slice(0, 4)}-{date.slice(4, 6)}-{date.slice(6, 8)}
              </span>
            </span>
            <span className="text-[var(--text-muted)]">
              共 <span className="font-bold text-[var(--text-primary)]">{stats.total}</span> 只
              <span className="mx-1 text-[var(--border-default)]">|</span>
              {list.pages} 页
            </span>
            <span className="text-[var(--fin-up)]">
              流入 {stats.inflowCount} 只
              <span className="ml-1 font-semibold">({fmtMoney(stats.inflowAmount)})</span>
            </span>
            <span className="text-[var(--fin-down)]">
              流出 {stats.outflowCount} 只
              <span className="ml-1 font-semibold">({fmtMoney(stats.outflowAmount)})</span>
            </span>
          </section>
        )}

        {/* 搜索 + 自选 + 表格 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="搜索代码 / 名称"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <button
            onClick={() => {
              setWatchlistOnly((v) => !v);
              setPage(1);
            }}
            title="仅显示自选股"
            className={cn(
              "flex h-8 items-center gap-1.5 border px-3 text-xs transition-colors",
              watchlistOnly
                ? "border-[var(--accent-primary)] bg-[rgba(242,193,78,0.15)] font-semibold text-[var(--accent-primary)]"
                : "border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Star className={cn("size-3.5", watchlistOnly && "fill-current")} />
            只看自选
            <span className="font-mono text-[11px] opacity-80">{favCount}</span>
          </button>
          <span className="text-xs text-[var(--text-muted)]">共 {filtered.length} 条匹配</span>
        </div>

        {list && list.items.length === 0 ? (
          <section className="flex flex-col items-center justify-center border border-[var(--border-default)] bg-[var(--bg-card)] py-24 text-[var(--text-muted)]">
            <Activity className="size-14 opacity-30" />
            <p className="mt-3 text-sm">当日无暗盘数据，请选择其他日期查询</p>
          </section>
        ) : (
          <div className="overflow-x-auto border border-[var(--border-default)] bg-[var(--bg-card)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                  <th className="w-10 px-2 py-2 text-center text-xs font-semibold text-[var(--text-secondary)]">自选</th>
                  {SORT_COLS.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => onSort(c.key)}
                      className={`cursor-pointer select-none px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${
                        c.align === "right" ? "text-right" : "text-left"
                      }`}
                    >
                      {c.label}
                      {sortKey === c.key && <span className="ml-1 text-[var(--accent-primary)]">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--text-secondary)]">板块</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={SORT_COLS.length + 2} className="py-12 text-center text-sm text-[var(--text-muted)]">
                      {watchlistOnly ? "自选中暂无当日暗盘数据，可在表格中用 ☆ 收藏" : "当前筛选无匹配"}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => {
                    const isFav = favoriteSet.has(codeToThscode(r.code));
                    return (
                      <tr key={r.code} className="border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--bg-card-hover)]">
                        <td className="px-2 py-1.5 text-center">
                          <button
                            onClick={() => toggleFavorite(codeToThscode(r.code))}
                            title={isFav ? "取消自选" : "加入自选"}
                            aria-label={isFav ? `取消自选 ${r.name}` : `加入自选 ${r.name}`}
                            className={cn(
                              "relative flex size-6 items-center justify-center transition-colors after:absolute after:-inset-1",
                              isFav
                                ? "text-[var(--accent-primary)]"
                                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
                            )}
                          >
                            <Star className={cn("size-4", isFav && "fill-current")} />
                          </button>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-muted)]">{r.code}</td>
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/darktrade/${r.code}`}
                        className="font-medium text-[var(--text-primary)] underline-offset-2 hover:text-[var(--accent-primary)] hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: signColor(r.darkFund) }}>
                      {fmtMoney(r.darkFund)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: signColor(r.brightFund) }}>
                      {fmtMoney(r.brightFund)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: signColor(r.mainNet) }}>
                      {fmtMoney(r.mainNet)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {r.activity.toFixed(2)}%
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {r.price.toFixed(2)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono tabular-nums font-medium"
                      style={{ color: signColor(r.changePct) }}
                    >
                      {r.changePct > 0 ? "+" : ""}
                      {r.changePct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {r.boards.map((b) => (
                          <span key={b} className="rounded-[3px] bg-[var(--bg-elevated)] px-1.5 py-px text-[11px] text-[var(--text-secondary)]">
                            {b}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                  );
                  })
                )}
              </tbody>
            </table>

            {/* 分页 */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-muted)]">
              <span>
                第 {curPage} / {totalPages} 页 · 每页 {PAGE_SIZE} 条
              </span>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>
                  上一页
                </Button>
                <Button size="xs" variant="outline" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>
                  下一页
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
