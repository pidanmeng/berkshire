'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { CompanyDetail } from '@/lib/api';
import { getCompanyDetail, getKline, getApiBase } from '@/lib/api';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import PriceChart from './PriceChart';
import RadarChart from './RadarChart';
import CapZoneBadge from './CapZoneBadge';
import Markdown from './Markdown';
import FinancialCompareChart from './FinancialCompareChart';
import ResearchDocsTabs from './ResearchDocsTabs';

const DIM_LABELS: Record<string, string> = {
  capability: '能力圈',
  moat: '护城河',
  business_model: '生意模式',
  management: '管理层诚信',
  inversion: '反向清单',
  historical: '历史类比',
};

/** 品种 → 中文标签（与 evaluate.ts VALUATION_ROUTING 口径一致） */
const VALUATION_TYPE_LABELS: Record<string, string> = {
  financial: '金融',
  cyclical: '周期',
  resource: '资源',
  conglomerate: '控股/多元集团',
  growth: '高成长',
  general: '一般工商',
  lossmaking: '亏损',
};

/** PEG 判读（与 quality-screen.ts PEG 分档一致：<1 低估 / 1-1.5 匹配 / 1.5-2 偏高 / >2 显著偏贵） */
function pegVerdict(p: number): { text: string; colorVar: string } {
  if (p < 1) return { text: '低估', colorVar: 'var(--accent-success)' };
  if (p <= 1.5) return { text: '匹配', colorVar: 'var(--accent-primary)' };
  if (p <= 2) return { text: '偏高', colorVar: 'var(--accent-warning)' };
  return { text: '显著偏贵', colorVar: 'var(--accent-danger)' };
}

const fmtYi = (v: number | null | undefined) =>
  v == null ? '—' : `${Math.round(v).toLocaleString()} 亿`;
const fmtNum = (v: number | null | undefined) =>
  v == null ? '—' : v.toFixed(1);
const fmtPctSigned = (v: number | null | undefined) =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`;

/** 从笔记正文提取 H2 章节（截止到下一个 H2） */
function extractSection(md: string, heading: string): string | null {
  const lines = md.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s+/.test(lines[i]) && lines[i].includes(heading)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    out.push(lines[i]);
  }
  const body = out.join('\n').trim();
  return body.length > 0 ? body : null;
}

export default function CompanyDashboard({
  thscode,
  initial,
  onClose,
}: {
  thscode: string;
  initial?: CompanyDetail;
  /** 内嵌看板模式：传入后头部显示 X 按钮，点击取消单选回到列表 */
  onClose?: () => void;
}) {
  const [detail, setDetail] = useState<CompanyDetail | null>(initial ?? null);
  const [bars, setBars] = useState<
    {
      date: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getCompanyDetail(thscode);
      setDetail(d);
    } catch {
      setError('详情获取失败（Elysia 后端不可达）');
    }
    try {
      const k = await getKline(thscode, 250);
      setBars(k.bars);
    } catch {
      // K 线失败不阻塞
    }
    setLoading(false);
  }, [thscode]);

  useEffect(() => {
    setDetail(initial ?? null);
    setBars([]);
    if (!initial) load();
    else {
      load(); // 仍拉 K 线并刷新详情
    }
  }, [thscode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !detail) {
    return (
      <div className="status-bar">
        <span className="dot wait" />
        加载中…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="status-bar">
        <span className="dot err" />
        {error ?? '未找到公司'}
      </div>
    );
  }

  const {
    note,
    quote,
    zone,
    marketCapYi,
    markdown,
    fundamental,
    updates = [],
    docs,
  } = detail;
  const totalSharesYi =
    quote.price && quote.price > 0 && marketCapYi != null && marketCapYi > 0
      ? +(marketCapYi / quote.price).toFixed(2)
      : null;

  const md = markdown ?? '';
  const capSection =
    extractSection(md, '估值区间与目标价') ?? extractSection(md, '目标市值');
  const trackSection = extractSection(md, '跟踪指标');
  const earnSection =
    extractSection(md, '财报精读 10 项检查清单') ??
    extractSection(md, '财报精读');

  const cap = note.targetMarketCapYi;
  const capMin =
    cap?.pessimistic ??
    Math.min(cap?.neutral ?? Infinity, cap?.optimistic ?? Infinity);
  const capMax =
    cap?.optimistic ?? Math.max(cap?.neutral ?? 0, cap?.pessimistic ?? 0);
  const capSpan = capMax > capMin ? capMax - capMin : 1;
  const markerPct =
    marketCapYi != null && capMin != null && capMax != null && marketCapYi >= 0
      ? Math.min(100, Math.max(0, ((marketCapYi - capMin) / capSpan) * 100))
      : null;

  // 目标市值 → 每股价格（总股本可算时展示，否则 —）
  const fmtSharePrice = (capYi: number | null | undefined) =>
    capYi == null || totalSharesYi == null || totalSharesYi <= 0
      ? '—'
      : `${(capYi / totalSharesYi).toFixed(2)} 元`;

  return (
    <div className="detail-grid">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="m-0 text-xl font-bold">{note.name}</h2>
            <span className="font-mono text-sm text-muted-foreground">
              {note.thscode}
            </span>
            <CapZoneBadge zone={zone.zone} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {[note.industry, note.subIndustry].filter(Boolean).join(' · ') ||
              '未分类'}
            {' · '}质量：{note.qualityVerdict ?? '—'}
            {note.qualityScore != null ? `（${note.qualityScore}/10）` : ''}
            {' · '}综合分：{fmtNum(note.composite)}
            {error && (
              <span className="ml-2 text-[var(--accent-danger)]">{error}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            className="back-link"
            href={`/darktrade/${note.thscode.split(".")[0]}`}
            target="_blank"
            rel="noreferrer"
          >
            暗盘 ↗
          </a>
          <a
            className="back-link"
            href={`/companies/${note.thscode}`}
            target="_blank"
            rel="noreferrer"
          >
            独立页 ↗
          </a>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="关闭详情，返回列表"
              title="返回列表"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* 一句话判断 */}
      <div className="card">
        <h3>一句话判断</h3>
        {[
          note.earnsFrom,
          note.earnsType,
          note.whyInvest,
          note.whyNotInvest,
        ].some((v) => !!v) ? (
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex items-baseline gap-2.5 text-[13px] leading-[1.6]">
              <span className="min-w-22 shrink-0 rounded-[3px] bg-(--bg-elevated) px-2 py-px text-left text-xs font-semibold text-(--text-secondary)">
                赚谁的钱
              </span>
              <span className="whitespace-normal text-(--text-primary)">
                {note.earnsFrom ?? '—'}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 text-[13px] leading-[1.6]">
              <span className="min-w-22 shrink-0 rounded-[3px] bg-(--bg-elevated) px-2 py-px text-left text-xs font-semibold text-(--text-secondary)">
                赚的是什么钱
              </span>
              <span className="whitespace-normal text-(--text-primary)">
                {note.earnsType ?? '—'}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 text-[13px] leading-[1.6]">
              <span className="min-w-22 shrink-0 rounded-[3px] bg-(--bg-elevated) px-2 py-px text-left text-xs font-semibold text-(--text-secondary)">
                为什么投资
              </span>
              <span className="whitespace-normal text-(--text-primary)">
                {note.whyInvest ?? '—'}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5 text-[13px] leading-[1.6]">
              <span className="min-w-22 shrink-0 rounded-[3px] bg-(--bg-elevated) px-2 py-px text-left text-xs font-semibold text-(--text-secondary)">
                为什么不投资
              </span>
              <span className="whitespace-normal text-(--text-primary)">
                {note.whyNotInvest ?? '—'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-(--text-muted)">
            该笔记尚未填写一句话判断（frontmatter 缺 earns_from / earns_type /
            why_invest / why_not_invest）。
          </div>
        )}
      </div>

      {/* 股价走势（近一年日 K） */}
      <div className="card">
        <h3>股价走势（近一年日 K）</h3>
        {bars.length > 0 ? (
          <PriceChart
            bars={bars}
            target={cap}
            marketCapYi={marketCapYi}
            totalSharesYi={totalSharesYi}
          />
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            K 线加载中或暂不可用…
          </div>
        )}
      </div>

      {/* 安全边际 + 六维雷达 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h3>安全边际 — 当前市值 vs 目标市值</h3>
          {cap ? (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  flexWrap: 'wrap',
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                <span>
                  悲观{' '}
                  <b
                    style={{
                      color: 'var(--accent-success)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {fmtYi(cap.pessimistic)}
                  </b>
                  <span className="ml-1 font-mono text-[var(--text-muted)]">
                    （{fmtSharePrice(cap.pessimistic)}）
                  </span>
                </span>
                <span>
                  合理{' '}
                  <b
                    style={{
                      color: 'var(--accent-warning)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {fmtYi(cap.neutral)}
                  </b>
                  <span className="ml-1 font-mono text-[var(--text-muted)]">
                    （{fmtSharePrice(cap.neutral)}）
                  </span>
                </span>
                <span>
                  乐观{' '}
                  <b
                    style={{
                      color: 'var(--accent-danger)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {fmtYi(cap.optimistic)}
                  </b>
                  <span className="ml-1 font-mono text-[var(--text-muted)]">
                    （{fmtSharePrice(cap.optimistic)}）
                  </span>
                </span>
              </div>
              <div className="cap-bar">
                <span style={{ width: 90 }}>当前 {fmtYi(marketCapYi)}</span>
                <div className="cap-track">
                  {markerPct != null && (
                    <div
                      className="cap-marker"
                      style={{ left: `${markerPct}%` }}
                      title="当前市值位置"
                    />
                  )}
                </div>
              </div>
              <div className="metric-grid">
                <div className="metric">
                  <div className="m-label">vs 悲观目标（低估≥0）</div>
                  <div
                    className="m-value"
                    style={{
                      color:
                        (zone.marginVsPess ?? -1) >= 0
                          ? 'var(--accent-success)'
                          : undefined,
                    }}
                  >
                    {fmtPctSigned(zone.marginVsPess)}
                  </div>
                </div>
                <div className="metric">
                  <div className="m-label">vs 合理目标</div>
                  <div className="m-value">
                    {fmtPctSigned(zone.distanceToNeutral)}
                  </div>
                </div>
                <div className="metric">
                  <div className="m-label">vs 乐观目标</div>
                  <div className="m-value">
                    {fmtPctSigned(zone.distanceToOpt)}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              该笔记尚无目标市值锚点（frontmatter 缺 target_market_cap_yi）。
            </div>
          )}
        </div>

        <div className="card">
          <h3>四大师六维评分（0-10 分）</h3>
          {note.scores ? (
            <>
              <RadarChart scores={note.scores} height={260} />
              <div className="flex flex-wrap gap-2 pt-2">
                {Object.entries(DIM_LABELS).map(([k, label]) => (
                  <span key={k} className="mini-tag">
                    {label} {fmtNum(note.scores?.[k] ?? null)}
                  </span>
                ))}
                <span
                  className="mini-tag"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  综合 {fmtNum(note.composite)}
                </span>
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              尚无结构化评分（backfill 未覆盖）。
            </div>
          )}
        </div>
      </div>

      {/* Forward PE + 基本面 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h3>Forward PE 快照</h3>
          {note.forwardPe?.value ? (
            <>
              <div className="price-row" style={{ marginBottom: 8 }}>
                <span className="price-main" style={{ fontSize: 26 }}>
                  {note.forwardPe.value.toFixed(1)}x
                </span>
                {note.forwardPe.baseNetProfitYi != null && (
                  <span className="sub">
                    基准净利 {fmtYi(note.forwardPe.baseNetProfitYi)}（
                    {note.forwardPe.basePeriod ?? '—'}）
                  </span>
                )}
              </div>
              {(note.valuationType || note.peg?.value != null) && (
                <div
                  className="flex flex-wrap items-center gap-2"
                  style={{ marginBottom: 8 }}
                >
                  {note.valuationType && (
                    <span
                      className="inline-flex items-center rounded-full border border-[var(--accent-primary)] px-2 py-0.5 text-xs font-medium text-[var(--accent-primary)]"
                      title={`估值模型路由品种（${note.valuationType}）`}
                    >
                      {VALUATION_TYPE_LABELS[note.valuationType] ??
                        note.valuationType}
                    </span>
                  )}
                  {note.peg?.value != null && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <span className="text-[var(--text-secondary)]">PEG</span>
                      <span
                        className="font-semibold"
                        style={{ color: pegVerdict(note.peg.value).colorVar }}
                      >
                        {note.peg.value.toFixed(2)}
                      </span>
                      <span
                        className="text-[var(--text-muted)]"
                        style={{ color: pegVerdict(note.peg.value).colorVar }}
                      >
                        {pegVerdict(note.peg.value).text}
                      </span>
                      {note.peg.growthBasis && (
                        <span className="text-[var(--text-muted)]">
                          （
                          {note.peg.growthBasis === 'forward'
                            ? '预测期增速'
                            : '单年同比'}
                          ）
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}
              {note.valuationModel && (
                <div style={{ marginTop: 10, marginBottom: 4 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                    }}
                  >
                    估值模型：
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {note.valuationModel.model ?? '—'}
                    </span>
                    {note.valuationModel.basePeriod && (
                      <span className="text-[var(--text-muted)]">
                        （{note.valuationModel.basePeriod}）
                      </span>
                    )}
                  </div>
                  {note.valuationModel.methodNote && (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginBottom: 6,
                      }}
                    >
                      {note.valuationModel.methodNote}
                    </div>
                  )}
                  {note.valuationModel.parameters && (
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ color: 'var(--text-muted)' }}>
                          <th style={{ textAlign: 'left', padding: '2px 8px 2px 0', fontWeight: 500 }}>情景</th>
                          <th style={{ textAlign: 'right', padding: '2px 8px', fontWeight: 500 }}>预测期净利（亿）</th>
                          <th style={{ textAlign: 'right', padding: '2px 0 2px 8px', fontWeight: 500 }}>倍数（x）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ['悲观', note.valuationModel.parameters.pessimistic],
                            ['中性', note.valuationModel.parameters.neutral],
                            ['乐观', note.valuationModel.parameters.optimistic],
                          ] as [string, { netProfitYi?: number; multiple?: number } | undefined][]
                        ).map(([label, p]) => (
                          <tr key={label} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '4px 8px 4px 0', color: 'var(--text-secondary)' }}>
                              {label}
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text-primary)' }}>
                              {p?.netProfitYi != null ? fmtYi(p.netProfitYi) : '—'}
                            </td>
                            <td style={{ padding: '4px 0 4px 8px', textAlign: 'right', color: 'var(--text-primary)' }}>
                              {p?.multiple != null ? p.multiple : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {note.forwardPe.factors && note.forwardPe.factors.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                    }}
                  >
                    核心影响因素：
                  </div>
                  <ul
                    style={{
                      margin: '0 0 8px',
                      paddingLeft: 18,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {note.forwardPe.factors.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </>
              )}
              {note.forwardPe.directions &&
                note.forwardPe.directions.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                        marginBottom: 4,
                      }}
                    >
                      可能发展方向：
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 13,
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {note.forwardPe.directions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </>
                )}
            </>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              尚无 Forward PE 锚点（frontmatter 缺 forward_pe）。
            </div>
          )}
        </div>

        <div className="card">
          <h3>基本面更新状态</h3>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {fundamental?.needsUpdate === true ? (
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="badge badge-red">基本面需更新</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <ul className="space-y-1">
                      {(fundamental.items ?? []).length > 0 ? (
                        fundamental.items!.map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="shrink-0 font-mono text-[10px] opacity-70">{f.date}</span>
                            <span className="min-w-0 flex-1 break-words">{f.title}</span>
                          </li>
                        ))
                      ) : (
                        <li>存在未采信财报</li>
                      )}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : fundamental?.needsUpdate === false ? (
              <span className="badge badge-green">已最新</span>
            ) : (
              <span className="badge badge-muted">待检测</span>
            )}
            {fundamental?.latestDate && (
              <span className="badge badge-primary">
                最新：{fundamental.latestDate}
              </span>
            )}
            <a
              className="back-link"
              href={`${getApiBase()}/api/fundamentals/${note.thscode}?refresh=1`}
              target="_blank"
              rel="noreferrer"
              title="强制重新检测巨潮公告"
            >
              ↻ 手动重新检测
            </a>
          </div>
          {fundamental?.latestTitle && (
            <div
              style={{
                color: 'var(--text-secondary)',
                fontSize: 13,
                marginBottom: 8,
              }}
            >
              {fundamental.latestTitle}
            </div>
          )}
          <div className="metric-grid">
            <div className="metric">
              <div className="m-label">调研覆盖财报期</div>
              <div className="m-value">
                {note.researchCutoff?.reportPeriod ?? '—'}
              </div>
            </div>
            <div className="metric">
              <div className="m-label">调研截止日</div>
              <div className="m-value">
                {note.researchCutoff?.announcementDate ??
                  note.researchCutoff?.reportDate ??
                  '—'}
              </div>
            </div>
            <div className="metric">
              <div className="m-label">最近检测</div>
              <div className="m-value" style={{ fontSize: 13 }}>
                {fundamental?.cachedAt
                  ? new Date(fundamental.cachedAt).toLocaleString('zh-CN')
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 调研章节 */}
      {capSection && (
        <div className="card">
          <h3>估值区间与目标价（笔记原文）</h3>
          <Markdown source={capSection} className="note-body" />
        </div>
      )}
      {trackSection && (
        <div className="card">
          <h3>跟踪指标（笔记原文）</h3>
          <Markdown source={trackSection} className="note-body" />
        </div>
      )}
      {earnSection && (
        <div className="card">
          <h3>财报精读 10 项检查清单（笔记原文）</h3>
          <Markdown source={earnSection} className="note-body" />
        </div>
      )}

      {/* 基本面更新（deep-dive-update 产物，公司文件夹内存在时展示） */}
      {updates.length > 0 && (
        <div className="card">
          <h3>基本面更新</h3>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-muted)',
              marginBottom: 12,
            }}
          >
            公司文件夹内存在 {updates.length} 份 deep-dive-update
            产物，聚焦最近一次研究的增量变化。
          </div>
          {updates.map((u, idx) => (
            <div
              key={u.fileName}
              style={{
                paddingTop: idx === 0 ? 0 : 16,
                borderTop:
                  idx === 0 ? 'none' : '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {u.updated && (
                  <span className="badge badge-primary">更新 {u.updated}</span>
                )}
                {u.dataAsOf && (
                  <span className="badge badge-muted">
                    数据时点 {u.dataAsOf}
                  </span>
                )}
                {u.qualityVerdict && (
                  <span
                    className={`badge ${u.qualityVerdict === 'GREEN' ? 'badge-green' : u.qualityVerdict === 'RED' ? 'badge-red' : 'badge-yellow'}`}
                  >
                    质量 {u.qualityVerdict}
                  </span>
                )}
              </div>
              {u.trigger && (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    margin: '6px 0 2px',
                  }}
                >
                  触发事件：{u.trigger}
                </div>
              )}
              {u.researchConclusion && (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    marginBottom: 6,
                  }}
                >
                  研究结论：{u.researchConclusion}
                </div>
              )}
              <Markdown source={u.markdown} className="note-body" />
            </div>
          ))}
        </div>
      )}

      {/* 基本面对比：上次研究（笔记 financials） vs 本次更新（update financials） */}
      {updates.length > 0 && (
        <div className="card">
          <h3>基本面对比（上次研究 vs 本次更新）</h3>
          {updates[0].financials ? (
            <FinancialCompareChart
              baseline={note.financials}
              update={updates[0].financials}
              baselineLabel="上次研究"
              updateLabel={`本次更新${updates[0].dataAsOf ? `（${updates[0].dataAsOf}）` : ''}`}
              height={300}
            />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              该 update 产物尚未写入 financials 结构化字段，无法生成对比图。
            </div>
          )}
        </div>
      )}

      {/* 研究报告原文：年报精读 / 年报原文（按公司名自动匹配，Tab 切换） */}
      {docs && (
        <ResearchDocsTabs
          thscode={thscode}
          deepReads={docs.deepReads ?? []}
          annualReports={docs.annualReports ?? []}
        />
      )}

      {md && (
        <div className="card">
          <h3>调研笔记全文</h3>
          <Markdown source={md} className="note-body" />
        </div>
      )}
    </div>
  );
}
