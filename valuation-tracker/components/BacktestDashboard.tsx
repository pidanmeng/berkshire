"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { BacktestResponse } from "@/lib/api";
import AppIconRail from "./AppIconRail";

const REPORT_LABEL: Record<string, string> = { 1: "一季报", 2: "中报", 3: "三季报" };
const reportLabel = (report: string) => {
  const q = report.split("-")[1];
  return q ? REPORT_LABEL[q] ?? report : report;
};

const fmtPct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`;
const fmtPctPlain = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const signColor = (v: number) =>
  v > 0 ? "var(--fin-up)" : v < 0 ? "var(--fin-down)" : "var(--fin-flat)";

const scoreColor = (s: number) =>
  s >= 7.5 ? "var(--accent-success)" : s >= 5.5 ? "var(--accent-warning)" : "var(--text-primary)";

// ===== 净值曲线（组合 vs 基准） =====
function NavChart({ nav }: { nav: BacktestResponse["nav"] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(4) : String(v)),
        backgroundColor: "rgba(17,17,17,0.96)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
      },
      legend: {
        data: ["组合净值", "沪深300"],
        textStyle: { color: "#a1a1a1" },
        top: 0,
      },
      grid: { left: 64, right: 24, top: 36, bottom: 44 },
      xAxis: {
        type: "category",
        data: nav.dates,
        axisLine: { lineStyle: { color: "#333333" } },
        axisLabel: { color: "#666666" },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#666666", fontFamily: "JetBrains Mono, Consolas, monospace", formatter: (v: number) => v.toFixed(2) },
        splitLine: { lineStyle: { color: "#262626", type: "dashed" } },
      },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", bottom: 4, start: 0, end: 100, textStyle: { color: "#666666" } },
      ],
      series: [
        {
          name: "组合净值",
          type: "line",
          data: nav.portfolio,
          showSymbol: false,
          lineStyle: { color: "#f2c14e", width: 2 },
          itemStyle: { color: "#f2c14e" },
          areaStyle: { color: "rgba(242,193,78,0.08)" },
        },
        {
          name: "沪深300",
          type: "line",
          data: nav.benchmark,
          showSymbol: false,
          lineStyle: { color: "#94a3b8", width: 1.5, type: "dashed" },
          itemStyle: { color: "#94a3b8" },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [nav]);

  return <div ref={ref} className="chart-container" />;
}

// ===== 模拟指数日K（蜡烛图 + 成交量） =====
function IndexKlineChart({ bars }: { bars: BacktestResponse["kline"] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const dates = bars.map((b) => b.date);
    const kline = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const volumes = bars.map((b) => b.volume);
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,17,17,0.96)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
      },
      legend: {
        data: ["指数K线", "成交量"],
        textStyle: { color: "#a1a1a1" },
        top: 0,
      },
      grid: [
        { left: 64, right: 30, top: 32, height: "56%" },
        { left: 64, right: 30, top: "72%", height: "16%" },
      ],
      xAxis: [
        { type: "category", data: dates, boundaryGap: true, axisLine: { lineStyle: { color: "#333333" } }, axisLabel: { color: "#666666" } },
        { type: "category", gridIndex: 1, data: dates, axisLabel: { show: false }, axisLine: { lineStyle: { color: "#333333" } } },
      ],
      yAxis: [
        {
          scale: true,
          axisLabel: { color: "#666666", fontFamily: "JetBrains Mono, Consolas, monospace" },
          splitLine: { lineStyle: { color: "#262626", type: "dashed" } },
        },
        { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 40, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 4, start: 40, end: 100, textStyle: { color: "#666666" } },
      ],
      series: [
        {
          name: "指数K线",
          type: "candlestick",
          data: kline,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
        },
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes,
          itemStyle: { color: "rgba(242,193,78,0.5)" },
        },
      ],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [bars]);

  return <div ref={ref} className="chart-container" />;
}

// ===== 统计卡片 =====
function StatCard({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-[var(--text-primary)]" style={color ? { color } : undefined}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

// ===== 主看板 =====
export default function BacktestDashboard({ initial }: { initial: BacktestResponse | null }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const data = initial;
  const isMock = data?.meta.dataSource === "mock";

  return (
    <div className="flex h-dvh min-w-0 w-full overflow-hidden">
      <AppIconRail className="h-full" />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* ===== Header ===== */}
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-2">
          <div>
            <h1 className="text-xl font-bold">基本面精选指数 · 回测</h1>
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {data
                ? `${data.meta.startDate} ~ ${data.meta.endDate} · 基准 ${data.meta.benchmark} · ${data.stats.periods} 期调仓`
                : "基本面筛查 Top10 等权 · 每年 3 次调仓（4月底一季报 / 8月底中报 / 10月底三季报）"}
            </div>
          </div>
          <span className={`badge ${isMock ? "badge-yellow" : "badge-green"}`}>
            {isMock ? "占位数据" : "真实回测"}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!data ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
              暂无回测数据
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {isMock && (
                <div className="status-bar" style={{ marginBottom: 0 }}>
                  <span className="dot err" />
                  <span style={{ color: "var(--accent-warning)" }}>
                    当前为占位数据（mock）· 回测引擎（.trae/scripts/backtest）落地后接入真实结果
                  </span>
                </div>
              )}

              {/* ===== 统计指标 ===== */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                <StatCard label="累计收益" value={fmtPct(data.stats.totalReturn)} color={signColor(data.stats.totalReturn)} />
                <StatCard label="年化收益" value={fmtPct(data.stats.annualReturn)} color={signColor(data.stats.annualReturn)} />
                <StatCard label="基准收益" value={fmtPct(data.stats.benchmarkReturn)} color={signColor(data.stats.benchmarkReturn)} />
                <StatCard label="超额收益" value={fmtPct(data.stats.excessReturn)} color={signColor(data.stats.excessReturn)} hint="相对沪深300" />
                <StatCard label="最大回撤" value={fmtPctPlain(data.stats.maxDrawdown)} color="var(--accent-danger)" />
                <StatCard label="夏普比率" value={data.stats.sharpe.toFixed(2)} color="var(--text-primary)" hint="年化 · 无风险2%" />
                <StatCard label="胜率" value={fmtPctPlain(data.stats.winRate)} hint="日收益跑赢基准" />
                <StatCard label="平均换手" value={`${data.stats.avgTurnover}%`} hint={`${data.stats.periods} 期调仓`} />
              </div>

              {/* ===== 净值曲线 ===== */}
              <div className="card">
                <h3>净值曲线 · 组合 vs {data.meta.benchmark}</h3>
                <NavChart nav={data.nav} />
                <div className="chart-source">
                  以调仓日收盘价建仓、下一交易日收盘价执行 · 分红再投资 · 等权 Top10
                </div>
              </div>

              {/* ===== 模拟指数日K ===== */}
              <div className="card">
                <h3>模拟指数日K（由组合收益构建点位）</h3>
                <IndexKlineChart bars={data.kline} />
                <div className="chart-source">模拟指数点位 = 1000 × 组合净值 · 成交量按当日波动放大（示意）</div>
              </div>

              {/* ===== 持仓与调仓明细 ===== */}
              <div className="card">
                <h3>持仓与调仓明细</h3>
                <div className="flex flex-wrap gap-2">
                  {data.holdings.map((h, i) => (
                    <button
                      key={h.period}
                      onClick={() => setActiveIdx(i)}
                      className={`border px-3 py-1.5 font-mono text-xs ${
                        i === activeIdx
                          ? "border-[var(--accent-primary)] bg-[rgba(242,193,78,0.18)] text-[var(--accent-primary)] font-semibold"
                          : "border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {h.period}
                      <span className="ml-2 text-[10px]">换手 {h.turnoverPct}%</span>
                    </button>
                  ))}
                </div>

                {data.holdings[activeIdx] && (
                  <div className="mt-3">
                    <div className="mb-2 text-xs text-[var(--text-secondary)]">
                      调仓日 {data.holdings[activeIdx]!.period} · 依据报告期{" "}
                      <span className="font-mono">{data.holdings[activeIdx]!.report}</span>（
                      {reportLabel(data.holdings[activeIdx]!.report)}）
                      {data.holdings[activeIdx]!.nextPeriod && (
                        <> · 持有至 {data.holdings[activeIdx]!.nextPeriod}</>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-muted)]">
                            <th className="py-2 pr-4 font-normal">代码</th>
                            <th className="py-2 pr-4 font-normal">名称</th>
                            <th className="py-2 pr-4 font-normal">行业</th>
                            <th className="py-2 pr-4 text-right font-normal">权重</th>
                            <th className="py-2 pr-4 text-right font-normal">综合分</th>
                            <th className="py-2 font-normal">来源</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.holdings[activeIdx]!.weights.map((w) => (
                            <tr key={w.thscode} className="border-b border-[var(--border-subtle)]">
                              <td className="py-2 pr-4">
                                <span className="co-code">{w.thscode}</span>
                              </td>
                              <td className="py-2 pr-4">
                                <span className="co-name">{w.name}</span>
                              </td>
                              <td className="py-2 pr-4 text-[var(--text-secondary)]">{w.industry}</td>
                              <td className="py-2 pr-4 text-right font-mono text-[var(--text-primary)]">
                                {w.weight.toFixed(1)}%
                              </td>
                              <td className="py-2 pr-4 text-right font-mono" style={{ color: scoreColor(w.score) }}>
                                {w.score.toFixed(1)}
                              </td>
                              <td className="py-2">
                                <span className={`badge ${w.pool === "明星池" ? "badge-green" : "badge-yellow"}`}>
                                  {w.pool}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
