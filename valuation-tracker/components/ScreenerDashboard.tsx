'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScreenerRow, ScreenerResponse, ScreenPool, QuoteItem } from '@/lib/api';
import { getScreener, getQuotes } from '@/lib/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import AppIconRail from './AppIconRail';

const POOL_TABS: { key: ScreenPool | 'all'; label: string; dot: string }[] = [
  { key: 'all', label: '全部', dot: '' },
  { key: 'star', label: '明星池', dot: '🟢' },
  { key: 'watch', label: '观察池', dot: '🟡' },
  { key: 'exclude', label: '排除池', dot: '🔴' },
  { key: 'loss', label: '亏损池', dot: '⚪' },
];

const SORT_COLS: { key: string; label: string }[] = [
  { key: 'score', label: '综合分' },
  { key: 'marketCapYi', label: '市值(亿)' },
  { key: 'pe', label: 'PE(TTM)' },
  { key: 'roe', label: 'ROE' },
  { key: 'revenueYoy', label: '营收同比' },
  { key: 'netProfitYoy', label: '净利同比' },
];

const POOL_BADGE: Record<ScreenPool, string> = {
  star: 'badge-green',
  watch: 'badge-yellow',
  exclude: 'badge-red',
  loss: 'badge-muted',
};
const POOL_LABEL: Record<ScreenPool, string> = {
  star: '明星',
  watch: '观察',
  exclude: '排除',
  loss: '亏损',
};
const VERDICT_BADGE: Record<string, string> = {
  GREEN: 'badge-green',
  YELLOW: 'badge-yellow',
  RED: 'badge-red',
};

const fmtPct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`);
const fmtNum = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const fmtYi = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('zh-CN'));
const signColor = (v: number | null) => {
  if (v === null || !Number.isFinite(v) || v === 0) return 'var(--fin-flat)';
  return v > 0 ? 'var(--fin-up)' : 'var(--fin-down)';
};

function SheetMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-[var(--text-primary)]" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** 个股初筛信息分屏（Sheet 右侧面板）— 点击表格行打开 */
function ScreenerRowSheet({ row, quoteFor }: { row: ScreenerRow; quoteFor: (r: ScreenerRow) => QuoteItem | undefined }) {
  const qt = quoteFor(row);
  const price = qt?.price ?? row.price;
  const chg = qt?.changePct ?? row.changePct;
  const pe = qt?.peTtm ?? row.peTtm;
  const pb = qt?.pbMrq ?? row.pbMrq;
  const mcap = qt?.marketCap != null ? qt.marketCap / 1e8 : row.marketCapYi;
  const scoreColor =
    row.overallScore >= 7.5 ? 'var(--accent-success)' : row.overallScore >= 5.5 ? 'var(--accent-warning)' : 'var(--text-primary)';

  const flagSections: { title: string; items: string[]; titleColor: string }[] = [
    { title: '正面亮点', items: row.greenHighlights, titleColor: 'var(--accent-success)' },
    { title: '黄色警告', items: row.yellowFlags, titleColor: 'var(--accent-warning)' },
    { title: '红色红旗', items: row.redFlags, titleColor: 'var(--accent-danger)' },
  ];

  const notes: { text: string; color: string }[] = [];
  if (row.highLeverageNote) notes.push({ text: '⚠️ 高杠杆(金融/地产复核)', color: 'var(--accent-warning)' });
  if (row.dataFailed) notes.push({ text: '⚠️ 数据失败', color: 'var(--accent-danger)' });
  if (row.reason) notes.push({ text: row.reason, color: 'var(--text-secondary)' });

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b border-[var(--border-subtle)] pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle className="text-lg font-bold text-[var(--text-primary)]">{row.name}</SheetTitle>
          <span className="font-mono text-xs text-[var(--text-muted)]">
            {row.ticker} · {row.thscode}
          </span>
        </div>
        <SheetDescription className="sr-only">个股初筛详情</SheetDescription>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`badge ${POOL_BADGE[row.pool]}`}>{POOL_LABEL[row.pool]}</span>
          <span className={`badge ${VERDICT_BADGE[row.verdict]}`}>{row.verdict}</span>
          <span className="text-[var(--text-secondary)]">
            综合分{' '}
            <span className="font-mono font-semibold" style={{ color: scoreColor }}>
              {row.overallScore.toFixed(1)}
            </span>
          </span>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">实时行情</h3>
          <div className="grid grid-cols-3 gap-2">
            <SheetMetric label="现价" value={fmtNum(price, 2)} color={chg !== null ? signColor(chg) : undefined} />
            <SheetMetric
              label="涨跌幅"
              value={chg === null ? '—' : `${chg > 0 ? '+' : ''}${fmtNum(chg, 2)}%`}
              color={signColor(chg)}
            />
            <SheetMetric label="市值(亿)" value={fmtYi(mcap)} />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">核心估值</h3>
          <div className="grid grid-cols-2 gap-2">
            <SheetMetric label="PE(TTM)" value={fmtNum(pe, 1)} />
            <SheetMetric label="PB(MRQ)" value={fmtNum(pb, 2)} />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">盈利质量</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SheetMetric label="ROE" value={fmtPct(row.roe)} />
            <SheetMetric label="ROE(上年)" value={fmtPct(row.roePrev)} />
            <SheetMetric label="毛利率" value={fmtPct(row.grossMargin)} />
            <SheetMetric label="净利率" value={fmtPct(row.netMargin)} />
            <SheetMetric label="OCF/NI" value={fmtNum(row.ocfToNi, 2)} />
            <SheetMetric label="负债率" value={fmtPct(row.debtRatio)} />
            <SheetMetric label="营收同比" value={fmtPct(row.revenueYoy)} color={signColor(row.revenueYoy)} />
            <SheetMetric label="净利同比" value={fmtPct(row.netProfitYoy)} color={signColor(row.netProfitYoy)} />
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">标记</h3>
          <div className="space-y-3 text-xs">
            {flagSections.map((s) => (
              <div key={s.title}>
                <div className="mb-1 font-semibold" style={{ color: s.titleColor }}>
                  {s.title}
                </div>
                {s.items.length > 0 ? (
                  <ul className="space-y-0.5 text-[var(--text-secondary)]">
                    {s.items.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[var(--text-muted)]">无</div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">备注</h3>
          {notes.length > 0 ? (
            <div className="space-y-1 text-xs">
              {notes.map((n, i) => (
                <div key={i} style={{ color: n.color }}>
                  {n.text}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">无</div>
          )}
        </section>
      </div>

      {row.researched && (
        <div className="border-t border-[var(--border-subtle)] p-4">
          <a
            href={`/companies/${row.thscode}`}
            className="inline-block border border-[var(--accent-primary)] bg-[rgba(242,193,78,0.12)] px-4 py-2 text-sm text-[var(--accent-primary)] hover:bg-[rgba(242,193,78,0.2)]"
            style={{ textDecoration: 'none' }}
          >
            查看公司研究 →
          </a>
        </div>
      )}
    </div>
  );
}

export default function ScreenerDashboard({ initial }: { initial: ScreenerResponse | null }) {
  const [pool, setPool] = useState<ScreenPool | 'all'>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [industry, setIndustry] = useState('');
  const [sort, setSort] = useState('score');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ScreenerResponse | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [quoteMap, setQuoteMap] = useState<Map<string, QuoteItem>>(new Map());
  const [quoteAt, setQuoteAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<ScreenerRow | null>(null);
  const [sheetRow, setSheetRow] = useState<ScreenerRow | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [qInput]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await getScreener({ pool, q, industry, sort, order, page, size: 50 });
      if ('error' in res) {
        setError((res as { message?: string }).message ?? '加载失败');
        return;
      }
      setData(res as ScreenerResponse);
    } catch {
      setError('Elysia 后端不可达');
    }
  }, [pool, q, industry, sort, order, page]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshQuotes = useCallback(async () => {
    if (!data || data.rows.length === 0) return;
    setRefreshing(true);
    setError(null);
    try {
      const qr = await getQuotes(data.rows.map((r) => r.thscode));
      setQuoteMap(new Map(qr.items.map((i) => [i.thscode, i])));
      setQuoteAt(qr.fetchedAt);
    } catch {
      setError('实时行情刷新失败');
    } finally {
      setRefreshing(false);
    }
  }, [data]);

  const stats = useMemo(() => data?.stats ?? null, [data]);
  const industries = useMemo(() => data?.industries ?? [], [data]);
  const rowCount = data?.page.total ?? 0;

  const onSort = (key: string) => {
    if (sort === key) {
      setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(key);
      setOrder('desc');
    }
    setPage(1);
  };

  const quoteFor = (r: ScreenerRow) => quoteMap.get(r.thscode);

  const meta = data?.meta;

  return (
    <div className="flex h-dvh min-w-0 w-full overflow-hidden">
      {/* ===== 最左侧页面导航 ICON 列（首页 / 全市场初筛）===== */}
      <AppIconRail className="h-full" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* ===== Header ===== */}
      <header className="px-4 py-2 flex items-center justify-between border-b">
        <div className="flex min-w-0 items-center gap-2">
          <div>
            <h1 className="text-xl font-bold">全市场初筛</h1>
            <div className="text-xs text-[var(--text-muted)] mt-2">
              {meta
                ? `报告期 ${meta.report}（上一年 ${meta.prevReport}）· 行情时点 ${meta.quoteAsOf} · 市值≥${meta.config.minMcapYi}亿${meta.config.excludeSt ? ' · 剔除ST/退' : ''}`
                : '三级漏斗初筛：明星池 = 明显有价值 · 排除池 = 明显垃圾'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <a href="/" className="text-[var(--text-muted)] hover:text-[var(--accent-primary)]" style={{ textDecoration: 'none' }}>
            ← 返回主看板
          </a>
          <button
            onClick={refreshQuotes}
            disabled={refreshing || rowCount === 0}
            className="border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:opacity-40"
          >
            {refreshing ? '刷新中…' : '刷新实时行情'}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <div className="status-bar">
            <span className="dot err" />
            <span style={{ color: 'var(--accent-danger)' }}>{error}</span>
          </div>
        )}

        {/* ===== 汇总卡 ===== */}
        <div className="summary-grid">
          <div className="summary-card">
            <div className="label">全市场</div>
            <div className="value">{stats?.universe ?? '—'}</div>
          </div>
          <div className="summary-card">
            <div className="label">主漏斗覆盖</div>
            <div className="value">{stats?.main ?? '—'}</div>
          </div>
          <div className="summary-card">
            <div className="label">明星池 🟢</div>
            <div className="value">{stats?.star ?? '—'}</div>
          </div>
          <div className="summary-card">
            <div className="label">观察池 🟡</div>
            <div className="value">{stats?.watch ?? '—'}</div>
          </div>
          <div className="summary-card">
            <div className="label">排除池 🔴</div>
            <div className="value down">{stats?.exclude ?? '—'}</div>
          </div>
          <div className="summary-card">
            <div className="label">亏损池</div>
            <div className="value warn">{stats?.loss ?? '—'}</div>
          </div>
          <div className="summary-card">
            <div className="label">数据失败</div>
            <div className="value">{stats?.dataFailed ?? '—'}</div>
          </div>
        </div>

        {/* ===== 池 Tab ===== */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {POOL_TABS.map((t) => {
            const count =
              t.key === 'all'
                ? stats ? stats.star + stats.watch + stats.exclude + stats.loss : null
                : stats ? stats[t.key] : null;
            const active = pool === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setPool(t.key);
                  setPage(1);
                }}
                className={`border px-3 py-1.5 text-xs ${
                  active
                    ? 'border-[var(--accent-primary)] bg-[rgba(242,193,78,0.18)] text-[var(--accent-primary)] font-semibold'
                    : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.dot} {t.label}
                {count !== null ? ` ${count}` : ''}
              </button>
            );
          })}
        </div>

        {/* ===== 筛选 ===== */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="搜索名称 / 代码"
            className="border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-primary)]"
          />
          <select
            value={industry}
            onChange={(e) => {
              setIndustry(e.target.value);
              setPage(1);
            }}
            className="border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]"
          >
            <option value="">全部行业</option>
            {industries.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
          <span className="ml-auto text-[var(--text-muted)]">
            {quoteAt
              ? `行情已刷新 ${new Date(quoteAt).toLocaleTimeString('zh-CN')}`
              : `行情时点 ${meta?.quoteAsOf ?? '—'}`}
            {' · '}共 {rowCount} 条
          </span>
        </div>

        {/* ===== 表格 ===== */}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称 / 代码</th>
                <th>行业</th>
                <th>池</th>
                {SORT_COLS.map((c) => (
                  <th key={c.key} onClick={() => onSort(c.key)} className={sort === c.key ? 'sorted-col' : undefined}>
                    {c.label}
                    {sort === c.key ? (order === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
                <th>判定</th>
                <th>毛利率</th>
                <th>净利率</th>
                <th>OCF/NI</th>
                <th>负债率</th>
                <th>红牌</th>
                <th>备注</th>
                <th>研究</th>
              </tr>
            </thead>
            <tbody>
              {data && data.rows.length > 0 ? (
                data.rows.map((r) => {
                  const qt = quoteFor(r);
                  const price = qt?.price ?? r.price;
                  const chg = qt?.changePct ?? r.changePct;
                  const pe = qt?.peTtm ?? r.peTtm;
                  const mcap = qt?.marketCap != null ? qt.marketCap / 1e8 : r.marketCapYi;
                  return (
                    <tr
                      key={r.thscode}
                      className={selected?.thscode === r.thscode ? 'row-selected' : undefined}
                      onClick={() => {
                        setSheetRow(r);
                        setSelected(r);
                      }}
                    >
                      <td>
                        <span className="co-name">{r.name}</span>
                        <div>
                          <span className="co-code">{r.thscode}</span>
                          {price !== null && (
                            <span className="co-code" style={{ color: signColor(chg), marginLeft: 6 }}>
                              {fmtNum(price, 2)}
                            </span>
                          )}
                          {chg !== null && chg !== 0 && (
                            <span className="co-code" style={{ color: signColor(chg), marginLeft: 6 }}>
                              {chg > 0 ? '+' : ''}{fmtNum(chg, 2)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td><span className="text-[var(--text-secondary)]">{r.industry ?? '—'}</span></td>
                      <td><span className={`badge ${POOL_BADGE[r.pool]}`}>{POOL_LABEL[r.pool]}</span></td>
                      <td className="num"><span style={{ color: r.overallScore >= 7.5 ? 'var(--accent-success)' : r.overallScore >= 5.5 ? 'var(--accent-warning)' : 'var(--text-primary)' }}>{r.overallScore.toFixed(1)}</span></td>
                      <td className="num"><span className={`badge ${VERDICT_BADGE[r.verdict]}`}>{r.verdict}</span></td>
                      <td className="num">{fmtYi(mcap)}</td>
                      <td className="num">{fmtNum(pe, 1)}</td>
                      <td className="num">{fmtPct(r.roe)}</td>
                      <td className="num" style={{ color: signColor(r.revenueYoy) }}>{fmtPct(r.revenueYoy)}</td>
                      <td className="num" style={{ color: signColor(r.netProfitYoy) }}>{fmtPct(r.netProfitYoy)}</td>
                      <td className="num">{fmtPct(r.grossMargin)}</td>
                      <td className="num">{fmtPct(r.netMargin)}</td>
                      <td className="num">{fmtNum(r.ocfToNi, 2)}</td>
                      <td className="num">{fmtPct(r.debtRatio)}</td>
                      <td className="num">
                        <span style={{ color: r.redFlags.length > 0 ? 'var(--accent-danger)' : 'var(--text-muted)' }}>
                          {r.redFlags.length}
                        </span>
                      </td>
                      <td>
                        <span className="text-[var(--text-muted)] text-xs">
                          {r.highLeverageNote && '⚠️高杠杆(金融/地产复核)'}
                          {r.dataFailed && '⚠️数据失败'}
                          {r.reason && !r.highLeverageNote && !r.dataFailed ? r.reason : ''}
                        </span>
                      </td>
                      <td>
                        {r.researched ? (
                          <a
                            href={`/companies/${r.thscode}`}
                            className="text-[var(--accent-primary)] hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            已研究 →
                          </a>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={17} className="text-center text-[var(--text-muted)] py-6">
                    {initial === null ? '数据加载中…' : '当前筛选无结果'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ===== 分页 ===== */}
        {data && data.page.totalPages > 1 && (
          <div className="flex items-center gap-3 justify-end mt-3 text-xs text-[var(--text-secondary)]">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="border border-[var(--border-default)] px-3 py-1 hover:border-[var(--accent-primary)] disabled:opacity-40"
            >
              上一页
            </button>
            <span>
              第 {data.page.page} / {data.page.totalPages} 页
            </span>
            <button
              disabled={page >= data.page.totalPages}
              onClick={() => setPage((p) => Math.min(data.page.totalPages, p + 1))}
              className="border border-[var(--border-default)] px-3 py-1 hover:border-[var(--accent-primary)] disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        )}

        <footer style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 12 }}>
          数据来源：同花顺（财务指标）+ 东财（市值/行业）· 综合分复用 quality-screen 口径 · 仅供研究参考，不构成投资建议。
        </footer>
      </div>
      </div>

      {/* ===== 个股初筛信息分屏（点击行打开）===== */}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full gap-0 border-l border-[var(--border-default)] bg-[var(--bg-card)] sm:max-w-xl"
        >
          {sheetRow && <ScreenerRowSheet row={sheetRow} quoteFor={quoteFor} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
