"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import type { BacktestResponse } from "@/lib/api";
import { fetchKlineRange, type MarketKlineBar } from "@/lib/market-data";
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

/** 调仓日 → 图表 x 轴上第一个 ≥ period 的交易日（真实建仓执行日，period 当天可能是周末） */
function execDateFor(dates: string[], period: string): string {
  return dates.find((d) => d >= period) ?? dates[dates.length - 1]!;
}

/** 由图表 x 轴日期 → 持仓期 index（execDates[k] ≤ date < execDates[k+1]，无归属返回 -1） */
function periodIndexFor(execDates: string[], date: string): number {
  let k = -1;
  for (let j = 0; j < execDates.length; j++) if (execDates[j]! <= date) k = j;
  return k;
}

/** 该日期所属持仓期的实时权重（份额×复权价÷组合净值，取自引擎 weightSeries）；
 *  取 dates 中 ≤ date 的最近一日；无数据返回 null（调用方回退初始权重） */
function liveWeightFor(
  series: BacktestResponse["weightSeries"] | undefined,
  k: number,
  date: string,
): Map<string, number> | null {
  const s = series?.[k];
  if (!s) return null;
  let idx = -1;
  for (let j = 0; j < s.dates.length; j++) if (s.dates[j]! <= date) idx = j;
  if (idx < 0) return null;
  const row = s.matrix[idx]!;
  const m = new Map<string, number>();
  s.codes.forEach((c, ci) => {
    const v = row[ci];
    if (v != null) m.set(c, v);
  });
  return m;
}

/** 日期平移（用于个股 K 线拉取时扩边上下文） */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ===== 图表公共：调仓 markLine + 选中期 markArea =====

/** 调仓日 markLine 配置（金色虚线，x 轴为执行日） */
function mkRebalanceMarkLine(execDates: string[], periods: string[]) {
  return {
    symbol: "none" as const,
    label: {
      show: true,
      position: "insideEndTop" as const,
      color: "#f2c14e",
      fontSize: 10,
      formatter: (p: { dataIndex?: number; value?: number | string }) => {
        const i = typeof p.dataIndex === "number" ? p.dataIndex : -1;
        return i >= 0 ? `调仓 ${periods[i] ?? ""}` : "调仓";
      },
    },
    lineStyle: { color: "rgba(242,193,78,0.75)", type: "dashed" as const, width: 1 },
    data: execDates.map((d, i) => ({ xAxis: d, name: `调仓 ${periods[i] ?? ""}` })),
  };
}

/** 选中持仓期 markArea 配置（半透明金色背景）；activeIdx < 0 为空 */
function mkPeriodMarkArea(execDates: string[], activeIdx: number) {
  if (activeIdx < 0 || activeIdx >= execDates.length) return { data: [] as unknown[] };
  const start = execDates[activeIdx]!;
  const end = execDates[activeIdx + 1] ?? execDates[execDates.length - 1]!;
  return {
    data: [[{ xAxis: start }, { xAxis: end }]],
    itemStyle: { color: "rgba(242,193,78,0.10)" },
  };
}

/** tooltip 持仓明细 HTML：显示该日所属持仓期 + 持仓列表（代码/名称/初始权重/实时权重） */
function periodTooltipHtml(
  date: string,
  topLines: string[],
  execDates: string[],
  holdings: BacktestResponse["holdings"],
  liveWeight: Map<string, number> | null,
): string {
  const k = periodIndexFor(execDates, date);
  const parts = [...topLines];
  if (k >= 0 && holdings[k]) {
    const h = holdings[k]!;
    const meta = [
      `调仓 ${h.period}`,
      reportLabel(h.report),
      h.trend ? `趋势 ${h.trend}` : null,
      `换手 ${h.turnoverPct}%`,
    ]
      .filter(Boolean)
      .join(" · ");
    parts.push(`<div style="margin-top:6px;color:#f2c14e;font-size:11px">持仓期 · ${meta}</div>`);
    parts.push(
      `<table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:11px">` +
        `<tr style="color:#8a8a8a"><td style="padding:1px 8px 1px 0">代码</td><td style="padding:1px 8px 1px 0">名称</td>` +
        `<td style="padding:1px 0;text-align:right">初始</td><td style="padding:1px 0 1px 8px;text-align:right">实时</td></tr>` +
        h.weights
          .map((w) => {
            const lw = liveWeight?.get(w.thscode);
            return (
              `<tr><td style="padding:1px 8px 1px 0;color:#a1a1a1;font-family:JetBrains Mono,Consolas,monospace">${w.thscode}</td>` +
              `<td style="padding:1px 8px 1px 0;color:#e5e5e5;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.name}</td>` +
              `<td style="padding:1px 0;text-align:right;color:#8a8a8a;font-family:JetBrains Mono,Consolas,monospace">${w.weight.toFixed(1)}</td>` +
              `<td style="padding:1px 0 1px 8px;text-align:right;color:${lw != null ? (lw > w.weight ? "#ef4444" : lw < w.weight ? "#22c55e" : "#f2c14e") : "#666666"};font-family:JetBrains Mono,Consolas,monospace;font-weight:600">${lw != null ? lw.toFixed(1) : "—"}</td></tr>`
            );
          })
          .join("") +
        `</table>` +
        (liveWeight
          ? `<div style="margin-top:4px;color:#8a8a8a;font-size:10px">实时 = 份额×复权价 ÷ 组合净值（权重随涨跌漂移，红色=增持 绿色=减持）</div>`
          : ""),
    );
  }
  return parts.join("");
}

// ===== 净值曲线（组合 vs 基准 + 调仓标记 + 区间高亮 + 悬浮持仓） =====
function NavChart({
  nav,
  holdings,
  weightSeries,
  execDates,
  activeIdx,
  onSelectPeriod,
}: {
  nav: BacktestResponse["nav"];
  holdings: BacktestResponse["holdings"];
  weightSeries: BacktestResponse["weightSeries"];
  execDates: string[];
  activeIdx: number;
  onSelectPeriod: (idx: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(17,17,17,0.97)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
        extraCssText: "max-width:360px;box-shadow:none;",
        formatter: (params: unknown) => {
          const p = (Array.isArray(params) ? params[0] : params) as { axisValue?: string; dataIndex?: number };
          const date = p.axisValue ?? nav.dates[p.dataIndex ?? 0] ?? "";
          const i = p.dataIndex ?? 0;
          const pv = nav.portfolio[i];
          const bv = nav.benchmark[i];
          const k = periodIndexFor(execDates, date);
          const lw = k >= 0 ? liveWeightFor(weightSeries, k, date) : null;
          return periodTooltipHtml(
            date,
            [
              `<div style="font-weight:600">${date}</div>`,
              `<div style="margin-top:2px;color:#f2c14e">组合 <b>${pv?.toFixed(4) ?? "—"}</b>` +
                `<span style="color:#8a8a8a">（${i > 0 ? fmtPct(pv / nav.portfolio[i - 1]! - 1) : "—"}）</span></div>`,
              `<div style="color:#94a3b8">基准 <b>${bv?.toFixed(4) ?? "—"}</b>` +
                `<span style="color:#8a8a8a">（${i > 0 ? fmtPct(bv / nav.benchmark[i - 1]! - 1) : "—"}）</span></div>`,
            ],
            execDates,
            holdings,
            lw,
          );
        },
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
          markLine: mkRebalanceMarkLine(execDates, holdings.map((h) => h.period)),
          markArea: mkPeriodMarkArea(execDates, activeIdx),
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
    chart.on("click", (params) => {
      const p = params as { componentType?: string; dataIndex?: number; data?: { xAxis?: string } };
      let date: string | undefined;
      if (p.componentType === "markLine") {
        date = p.data?.xAxis;
      } else if (typeof p.dataIndex === "number") {
        date = nav.dates[p.dataIndex];
      }
      if (date) {
        const k = periodIndexFor(execDates, date);
        if (k >= 0) onSelectPeriod(k);
      }
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, execDates, weightSeries]);

  // 选中期变化 → 仅更新 markArea（不重建图表）
  useEffect(() => {
    chartRef.current?.setOption({
      series: [{ name: "组合净值", markArea: mkPeriodMarkArea(execDates, activeIdx) }],
    });
  }, [activeIdx, execDates]);

  return <div ref={ref} className="chart-container" />;
}

// ===== 模拟指数日K（蜡烛图 + 成交量 + 调仓标记 + 区间高亮 + 悬浮持仓） =====
function IndexKlineChart({
  bars,
  holdings,
  weightSeries,
  execDates,
  activeIdx,
  onSelectPeriod,
}: {
  bars: BacktestResponse["kline"];
  holdings: BacktestResponse["holdings"];
  weightSeries: BacktestResponse["weightSeries"];
  execDates: string[];
  activeIdx: number;
  onSelectPeriod: (idx: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const dates = bars.map((b) => b.date);
    const kline = bars.map((b) => [b.open, b.close, b.low, b.high]);
    const volumes = bars.map((b) => b.volume);
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,17,17,0.97)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
        extraCssText: "max-width:360px;box-shadow:none;",
        formatter: (params: unknown) => {
          const p = (Array.isArray(params) ? params[0] : params) as { axisValue?: string; dataIndex?: number };
          const date = p.axisValue ?? dates[p.dataIndex ?? 0] ?? "";
          const i = p.dataIndex ?? 0;
          const b = bars[i];
          const k = periodIndexFor(execDates, date);
          const lw = k >= 0 ? liveWeightFor(weightSeries, k, date) : null;
          return periodTooltipHtml(
            date,
            [
              `<div style="font-weight:600">${date}</div>`,
              `<div style="margin-top:2px;color:#f2c14e">点位 <b>${b ? b.close.toFixed(2) : "—"}</b></div>`,
            ],
            execDates,
            holdings,
            lw,
          );
        },
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
          markLine: mkRebalanceMarkLine(execDates, holdings.map((h) => h.period)),
          markArea: mkPeriodMarkArea(execDates, activeIdx),
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
    chart.on("click", (params) => {
      const p = params as { componentType?: string; dataIndex?: number; data?: { xAxis?: string } };
      let date: string | undefined;
      if (p.componentType === "markLine") {
        date = p.data?.xAxis;
      } else if (typeof p.dataIndex === "number") {
        date = dates[p.dataIndex];
      }
      if (date) {
        const k = periodIndexFor(execDates, date);
        if (k >= 0) onSelectPeriod(k);
      }
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, execDates, weightSeries]);

  // 选中期变化 → 仅更新 markArea
  useEffect(() => {
    chartRef.current?.setOption({
      series: [{ name: "指数K线", markArea: mkPeriodMarkArea(execDates, activeIdx) }],
    });
  }, [activeIdx, execDates]);

  return <div ref={ref} className="chart-container" />;
}

// ===== 个股区间 K 线卡片（点击持仓个股后展开） =====
function StockKlineCard({
  stock,
  onClose,
}: {
  stock: { thscode: string; name: string; period: string; nextPeriod: string | null };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ bars: MarketKlineBar[]; error: string | null }>({ bars: [], error: null });

  useEffect(() => {
    let alive = true;
    setState({ bars: [], error: null });
    // 区间前后各扩 25 个自然日作上下文（调仓日/止盈日标记得以呈现）
    const begin = shiftDate(stock.period, -25);
    const end = stock.nextPeriod ? shiftDate(stock.nextPeriod, 25) : "2050-01-01";
    fetchKlineRange(stock.thscode, begin, end)
      .then(({ bars }) => {
        if (alive) {
          setState({
            bars,
            error: bars.length === 0 ? "该区间无 K 线数据（可能尚未上市 / 长期停牌 / 已退市）" : null,
          });
        }
      })
      .catch((e) => {
        if (alive) setState({ bars: [], error: `K 线加载失败：${e?.message ?? String(e)}` });
      });
    return () => {
      alive = false;
    };
  }, [stock.thscode, stock.period, stock.nextPeriod]);

  useEffect(() => {
    if (!ref.current || state.bars.length === 0) return;
    const chart = echarts.init(ref.current);
    const dates = state.bars.map((b) => b.date);
    const kline = state.bars.map((b) => [b.open, b.close, b.low, b.high]);
    const volumes = state.bars.map((b) => b.volume);
    // 调仓日（period 当天或之后第一根 K 线）标记
    const mkData = dates.find((d) => d >= stock.period);
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,17,17,0.97)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v)),
      },
      legend: {
        data: ["个股K线", "成交量"],
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
        { type: "inside", xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 4, start: 0, end: 100, textStyle: { color: "#666666" } },
      ],
      series: [
        {
          name: "个股K线",
          type: "candlestick",
          data: kline,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
          markLine: {
            symbol: "none",
            label: { show: true, position: "insideEndTop", color: "#f2c14e", fontSize: 10, formatter: `调仓 ${stock.period}` },
            lineStyle: { color: "rgba(242,193,78,0.85)", type: "dashed", width: 1.5 },
            data: mkData ? [{ xAxis: mkData }] : [],
          },
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
  }, [state.bars, stock]);

  const first = state.bars[0];
  const last = state.bars[state.bars.length - 1];
  const periodRet = first && last ? last.close / first.close - 1 : null;
  const periodHigh = state.bars.length > 0 ? Math.max(...state.bars.map((b) => b.high)) : null;
  const periodLow = state.bars.length > 0 ? Math.min(...state.bars.map((b) => b.low)) : null;

  return (
    <div className="mt-4 border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="co-code">{stock.thscode}</span>{" "}
          <span className="co-name">{stock.name}</span>
          <span className="ml-2 text-xs text-[var(--text-secondary)]">
            持仓期 {stock.period} → {stock.nextPeriod ?? "至今"}
          </span>
          {periodRet !== null && (
            <span className="ml-2 text-xs font-mono" style={{ color: signColor(periodRet) }}>
              区间 {fmtPct(periodRet)}
            </span>
          )}
          {periodHigh != null && periodLow != null && (
            <span className="ml-2 text-xs font-mono text-[var(--text-secondary)]">
              高 {periodHigh.toFixed(2)} / 低 {periodLow.toFixed(2)}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          关闭
        </button>
      </div>
      {state.error ? (
        <div className="py-6 text-center text-xs text-[var(--accent-warning)]">{state.error}</div>
      ) : state.bars.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--text-muted)]">加载 K 线…</div>
      ) : (
        <div ref={ref} className="chart-container" />
      )}
      <div className="chart-source">前复权日K（东财）· 虚线为调仓日 · 区间已前后扩 25 个自然日作上下文</div>
    </div>
  );
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
  const [selectedStock, setSelectedStock] = useState<{
    thscode: string;
    name: string;
    period: string;
    nextPeriod: string | null;
  } | null>(null);
  const data = initial;
  const isMock = data?.meta.dataSource === "mock";

  // 调仓执行日（图表 x 轴上的实际建仓日）
  const execDates = useMemo(
    () => (data ? data.holdings.map((h) => execDateFor(data.nav.dates, h.period)) : []),
    [data],
  );

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
                <NavChart
                  nav={data.nav}
                  holdings={data.holdings}
                  weightSeries={data.weightSeries}
                  execDates={execDates}
                  activeIdx={activeIdx}
                  onSelectPeriod={setActiveIdx}
                />
                <div className="chart-source">
                  虚线 = 调仓执行日（点击图表任一点可选中对应持仓期）· 悬浮查看当日持仓 · 买入持有（份额×后复权价 + 现金）· 分红再投资
                </div>
              </div>

              {/* ===== 模拟指数日K ===== */}
              <div className="card">
                <h3>模拟指数日K（由组合收益构建点位）</h3>
                <IndexKlineChart
                  bars={data.kline}
                  holdings={data.holdings}
                  weightSeries={data.weightSeries}
                  execDates={execDates}
                  activeIdx={activeIdx}
                  onSelectPeriod={setActiveIdx}
                />
                <div className="chart-source">模拟指数点位 = 1000 × 组合净值 · 成交量按当日波动放大（示意）· 点击图表选中持仓期后下方明细同步高亮</div>
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
                    {/* 期末实时权重：取 weightSeries 该期最后一日（初始权重随涨跌漂移后的实际仓位） */}
                    {(() => {
                      const wsK = data.weightSeries?.[activeIdx];
                      const lastRow = wsK && wsK.matrix.length > 0 ? wsK.matrix[wsK.matrix.length - 1]! : null;
                      const liveW = (thscode: string): number | null => {
                        if (!wsK || !lastRow) return null;
                        const ci = wsK.codes.indexOf(thscode);
                        return ci >= 0 ? (lastRow[ci] ?? null) : null;
                      };
                      return (
                        <>
                          <div className="mb-2 text-xs text-[var(--text-secondary)]">
                            调仓日 {data.holdings[activeIdx]!.period} · 依据报告期{" "}
                            <span className="font-mono">{data.holdings[activeIdx]!.report}</span>（
                            {reportLabel(data.holdings[activeIdx]!.report)}）
                            {data.holdings[activeIdx]!.trend && (
                              <> · 趋势 {data.holdings[activeIdx]!.trend}</>
                            )}
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
                                  <th className="py-2 pr-4 text-right font-normal">初始权重</th>
                                  <th className="py-2 pr-4 text-right font-normal">实时权重</th>
                                  <th className="py-2 pr-4 text-right font-normal">综合分</th>
                                  <th className="py-2 font-normal">来源</th>
                                </tr>
                              </thead>
                              <tbody>
                                {data.holdings[activeIdx]!.weights.map((w) => {
                                  const lw = liveW(w.thscode);
                                  return (
                                    <tr
                                      key={w.thscode}
                                      onClick={() =>
                                        setSelectedStock({
                                          thscode: w.thscode,
                                          name: w.name,
                                          period: data.holdings[activeIdx]!.period,
                                          nextPeriod: data.holdings[activeIdx]!.nextPeriod,
                                        })
                                      }
                                      className={`cursor-pointer border-b border-[var(--border-subtle)] transition-colors ${
                                        selectedStock?.thscode === w.thscode && selectedStock?.period === data.holdings[activeIdx]!.period
                                          ? "bg-[rgba(242,193,78,0.12)]"
                                          : "hover:bg-[rgba(242,193,78,0.06)]"
                                      }`}
                                    >
                                      <td className="py-2 pr-4">
                                        <span className="co-code">{w.thscode}</span>
                                      </td>
                                      <td className="py-2 pr-4">
                                        <span className="co-name">{w.name}</span>
                                      </td>
                                      <td className="py-2 pr-4 text-[var(--text-secondary)]">{w.industry ?? "—"}</td>
                                      <td className="py-2 pr-4 text-right font-mono text-[var(--text-primary)]">
                                        {w.weight.toFixed(1)}%
                                      </td>
                                      <td
                                        className="py-2 pr-4 text-right font-mono"
                                        style={{
                                          color: lw == null ? "var(--text-muted)" : lw > w.weight ? "var(--fin-up)" : lw < w.weight ? "var(--fin-down)" : "var(--fin-flat)",
                                        }}
                                        title={lw == null ? "无实时数据（停牌/缺价）" : "期末实时仓位（份额×复权价÷组合净值）"}
                                      >
                                        {lw == null ? "—" : `${lw.toFixed(1)}%`}
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
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                            实时权重 = 期末份额×复权价 ÷ 组合净值（买入持有下权重随涨跌漂移，红=增持 绿=减持）· 点击持仓行展开该股在持仓期的 K 线走势
                          </div>

                          {/* ===== 个股区间 K 线 ===== */}
                          {selectedStock && selectedStock.period === data.holdings[activeIdx]!.period && (
                            <StockKlineCard stock={selectedStock} onClose={() => setSelectedStock(null)} />
                          )}
                        </>
                      );
                    })()}
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
