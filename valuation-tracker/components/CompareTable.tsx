'use client';

import type { ReactNode } from 'react';
import type { CompanyItem } from '@/lib/api';
import CapZoneBadge from './CapZoneBadge';
import RadarChart from './RadarChart';

const DIM_LABELS: Record<string, string> = {
  capability: '能力圈',
  moat: '护城河',
  business_model: '生意模式',
  management: '管理层',
  inversion: '反向清单',
  historical: '历史类比',
};

const fmtYi = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(v).toLocaleString()} 亿`;
const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(1);
const fmtPrice = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(2);
const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function QualityBadge({ v }: { v: string | null }) {
  if (!v) return <span className="badge badge-muted">—</span>;
  const cls =
    v === 'GREEN' ? 'badge-green' : v === 'RED' ? 'badge-red' : 'badge-yellow';
  return <span className={`badge ${cls}`}>{v}</span>;
}

function scoreCell(v: number | null | undefined): ReactNode {
  return (
    <span
      style={{
        color:
          v != null && v >= 8
            ? 'var(--accent-success)'
            : v != null && v >= 6
              ? 'var(--accent-warning)'
              : undefined,
      }}
    >
      {fmtNum(v)}
    </span>
  );
}

/** 多公司横向比较：公司为列、指标为行 */
export default function CompareTable({ items }: { items: CompanyItem[] }) {
  const rows: {
    label: string;
    align?: 'num' | 'text';
    render: (it: CompanyItem) => ReactNode;
  }[] = [
    { label: '现价', render: (it) => <>{fmtPrice(it.quote.price)}</> },
    {
      label: '涨跌',
      render: (it) => (
        <span
          style={{
            color:
              it.quote.changePct != null
                ? it.quote.changePct > 0
                  ? 'var(--fin-up)'
                  : it.quote.changePct < 0
                    ? 'var(--fin-down)'
                    : undefined
                : undefined,
          }}
        >
          {fmtPct(it.quote.changePct)}
        </span>
      ),
    },
    { label: '总市值', render: (it) => <>{fmtYi(it.marketCapYi)}</> },
    { label: 'PE-TTM', render: (it) => <>{fmtNum(it.quote.peTtm)}</> },
    { label: 'PB(MRQ)', render: (it) => <>{fmtNum(it.quote.pbMrq)}</> },
    { label: 'PS-TTM', render: (it) => <>{fmtNum(it.quote.psTtm)}</> },
    { label: 'PCF-TTM', render: (it) => <>{fmtNum(it.quote.pcfTtm)}</> },
    ...Object.entries(DIM_LABELS).map(([k, label]) => ({
      label,
      render: (it: CompanyItem) => scoreCell(it.scores?.[k] ?? null),
    })),
    { label: '综合分（加权）', render: (it) => scoreCell(it.composite) },
    { label: '安全边际', render: (it) => <CapZoneBadge zone={it.zone.zone} /> },
    {
      label: 'vs 悲观目标',
      render: (it) => (
        <span
          style={{
            color:
              (it.zone.marginVsPess ?? -1) >= 0
                ? 'var(--accent-success)'
                : undefined,
          }}
        >
          {it.zone.marginVsPess != null
            ? `${(it.zone.marginVsPess * 100).toFixed(1)}%`
            : '—'}
        </span>
      ),
    },
    {
      label: '目标市值（悲/合/乐）',
      render: (it) => (
        <>
          {it.targetMarketCapYi
            ? `${fmtYi(it.targetMarketCapYi.pessimistic ?? null)} / ${fmtYi(it.targetMarketCapYi.neutral ?? null)} / ${fmtYi(it.targetMarketCapYi.optimistic ?? null)}`
            : '—'}
        </>
      ),
    },
    {
      label: 'Forward PE',
      render: (it) => (
        <>{it.forwardPe?.value != null ? it.forwardPe.value.toFixed(1) : '—'}</>
      ),
    },
    {
      label: '质量筛查',
      render: (it) => <QualityBadge v={it.qualityVerdict} />,
    },
    {
      label: '基本面',
      render: (it) =>
        it.needsUpdate === true ? (
          <span className="badge badge-red">需更新</span>
        ) : it.needsUpdate === false ? (
          <span className="badge badge-green">已最新</span>
        ) : (
          <span className="badge badge-muted">待检测</span>
        ),
    },
    // 一句话判断（文本行，允许换行）
    {
      label: '赚谁的钱',
      align: 'text',
      render: (it) => <>{it.earnsFrom || '—'}</>,
    },
    {
      label: '赚的是什么钱',
      align: 'text',
      render: (it) => <>{it.earnsType || '—'}</>,
    },
    {
      label: '为什么投资',
      align: 'text',
      render: (it) => <>{it.whyInvest || '—'}</>,
    },
    {
      label: '为什么不投资',
      align: 'text',
      render: (it) => <>{it.whyNotInvest || '—'}</>,
    },
  ];

  return (
    <div className="space-y-4">
      {items.length >= 2 && (
        <div className="card">
          <h3>六维评分横向对比</h3>
          <RadarChart
            series={items.map((it) => ({
              name: it.name,
              scores: it.scores ?? {},
            }))}
            height={320}
          />
        </div>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ minWidth: 140 }}>指标</th>
              {items.map((it) => (
                <th key={it.thscode}>
                  {it.name}
                  <div className="co-code">{it.thscode}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {r.label}
                </td>
                {items.map((it) => (
                  <td
                    key={it.thscode}
                    className={r.align === 'text' ? 'align-top' : 'num'}
                  >
                    {r.align === 'text' ? (
                      <div className="min-w-[220px] max-w-[360px] whitespace-normal leading-[1.55]">
                        {r.render(it)}
                      </div>
                    ) : (
                      r.render(it)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
