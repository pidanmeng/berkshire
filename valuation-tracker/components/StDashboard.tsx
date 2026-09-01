'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { StListItem, StListResponse, StType } from '@/lib/api';
import AppIconRail from './AppIconRail';

const TYPE_TABS: { key: StType | 'all' | 'researched'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: '*ST', label: '*ST（退市风险）' },
  { key: 'ST', label: 'ST（其他风险）' },
  { key: '退', label: '退市整理' },
  { key: 'researched', label: '已研究' },
];

const TYPE_BADGE: Record<StType, string> = {
  ST: 'badge-yellow',
  '*ST': 'badge-red',
  退: 'badge-muted',
};
const RISK_BADGE: Record<string, string> = {
  高: 'badge-red',
  中: 'badge-yellow',
  低: 'badge-green',
};

const fmtPctSigned = (v: number | null) =>
  v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const fmtYi = (v: number | null) =>
  v === null || !Number.isFinite(v) ? '—' : `${Math.round(v / 1e8).toLocaleString('zh-CN')} 亿`;
const signColor = (v: number | null) => {
  if (v === null || !Number.isFinite(v) || v === 0) return 'var(--fin-flat)';
  return v > 0 ? 'var(--fin-up)' : 'var(--fin-down)';
};

export default function StDashboard({ initial }: { initial?: StListResponse | null }) {
  const [tab, setTab] = useState<StType | 'all' | 'researched'>('all');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    let list = initial?.items ?? [];
    if (tab === 'researched') list = list.filter((r) => r.researched);
    else if (tab !== 'all') list = list.filter((r) => r.stType === tab);
    if (q.trim()) {
      const kw = q.trim().toUpperCase();
      list = list.filter((r) => r.name.toUpperCase().includes(kw) || r.thscode.toUpperCase().includes(kw));
    }
    // 已研究优先，其次按市值降序（未取到市值的排后）
    return [...list].sort((a, b) => {
      if (a.researched !== b.researched) return a.researched ? -1 : 1;
      return (b.mcap ?? -1) - (a.mcap ?? -1);
    });
  }, [initial, tab, q]);

  const count = (key: StType | 'all' | 'researched') => {
    const list = initial?.items ?? [];
    if (key === 'all') return list.length;
    if (key === 'researched') return list.filter((r) => r.researched).length;
    return list.filter((r) => r.stType === key).length;
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <AppIconRail className="h-full" />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--border-default)] px-4 py-2">
          <div>
            <h1 className="m-0 text-xl font-bold">ST 专题</h1>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              全市场 ST/*ST/退市整理名单 · 公告驱动监控 · 已研究公司跳转详情
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            {initial?.updatedAt && (
              <span className="font-mono">
                {new Date(initial.updatedAt).toLocaleString('zh-CN')} 更新
              </span>
            )}
            <a
              className="text-[var(--accent-primary)] underline-offset-2 hover:underline"
              href="https://www.cninfo.com.cn/new/disclosure/stock?stockCode=&orgId="
              target="_blank"
              rel="noreferrer"
            >
              巨潮官网 ↗
            </a>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] px-4 py-2">
          {TYPE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                tab === t.key
                  ? 'bg-[rgba(242,193,78,0.14)] text-[var(--accent-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.label}
              <span className="ml-1 font-mono opacity-70">{count(t.key)}</span>
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索代码 / 名称"
            className="ml-auto w-48 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)]"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead className="sticky top-0 z-10 bg-[var(--bg-page)]">
              <tr className="text-xs text-[var(--text-muted)]" style={{ borderBottom: '1px solid var(--border-default)' }}>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">代码 / 名称</th>
                <th className="px-4 py-2 font-medium">板块</th>
                <th className="px-4 py-2 text-right font-medium">现价</th>
                <th className="px-4 py-2 text-right font-medium">涨跌幅</th>
                <th className="px-4 py-2 text-right font-medium">总市值</th>
                <th className="px-4 py-2 font-medium">研究状态</th>
                <th className="px-4 py-2 font-medium">退市风险</th>
                <th className="px-4 py-2 font-medium">摘帽路径</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.thscode} row={r} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
                    暂无匹配项
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="border-t border-[var(--border-default)] px-4 py-2 text-xs text-[var(--text-muted)]">
          数据源：同花顺 tickers（名单）· 东财/同花顺行情 · 调研笔记（已研究标记）。ST 股票为高风险标的，规则详见投研知识库「A股ST戴帽摘帽退市规则」。
        </footer>
      </div>
    </div>
  );
}

function Row({ row }: { row: StListItem }) {
  const router = useRouter();
  const badge = TYPE_BADGE[row.stType];
  const label = row.stType === '*ST' ? '*ST' : row.stType === 'ST' ? 'ST' : '退';
  return (
    <tr
      onClick={() => {
        if (row.researched) router.push(`/companies/${row.thscode}`);
      }}
      title={row.researched ? '查看公司详情' : '尚未投研覆盖'}
      className={
        row.researched
          ? 'cursor-pointer hover:bg-[rgba(242,193,78,0.06)]'
          : 'opacity-80 hover:bg-[var(--bg-elevated)]'
      }
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <td className="px-4 py-2">
        <span className={`badge ${badge}`}>{label}</span>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-muted)]">{row.thscode}</span>
          <span className="font-semibold text-[var(--text-primary)]">{row.name}</span>
          {row.researched && (
            <span className="rounded-[3px] bg-[rgba(242,193,78,0.12)] px-1.5 py-px text-[10px] text-[var(--accent-primary)]">
              详情 ↗
            </span>
          )}
        </div>
        {row.stReason && (
          <div className="mt-0.5 max-w-xs truncate text-[11px] text-[var(--text-muted)]" title={row.stReason}>
            {row.stReason}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-[var(--text-secondary)]">{row.market}</td>
      <td className="px-4 py-2 text-right font-mono text-[var(--text-primary)]">
        {row.price !== null && row.price > 0 ? row.price.toFixed(2) : '—'}
      </td>
      <td className="px-4 py-2 text-right font-mono" style={{ color: signColor(row.pct) }}>
        {fmtPctSigned(row.pct)}
      </td>
      <td className="px-4 py-2 text-right font-mono text-xs text-[var(--text-secondary)]">{fmtYi(row.mcap)}</td>
      <td className="px-4 py-2">
        {row.researched ? (
          <span className="badge badge-primary">
            已研究{row.stStatus ? ` · ${row.stStatus}` : ''}
          </span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">未研究</span>
        )}
      </td>
      <td className="px-4 py-2">
        {row.delistRisk ? (
          <span className={`badge ${RISK_BADGE[row.delistRisk] ?? 'badge-muted'}`}>{row.delistRisk}</span>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-[var(--text-secondary)]">{row.removalPath ?? '—'}</td>
    </tr>
  );
}
