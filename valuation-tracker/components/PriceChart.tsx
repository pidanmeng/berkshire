"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { CompanyItem } from "@/lib/api";

type MarkLineData = NonNullable<echarts.MarkLineComponentOption["data"]>;

/** 目标市值参考线（悲观/合理/乐观） */
function capLine(value: number | undefined, color: string, label: string): MarkLineData[number] | null {
  if (value === undefined || value <= 0) return null;
  return {
    name: label,
    yAxis: value,   // 亿元
    lineStyle: { color, type: "dashed" as const, width: 1 },
    label: { formatter: `${label} ${value.toLocaleString()}亿`, color },
  };
}

export default function PriceChart({
  bars,
  target,
  marketCapYi,
  totalSharesYi,
}: {
  bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  target: CompanyItem["targetMarketCapYi"];
  marketCapYi: number | null;
  totalSharesYi?: number | null;
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

    // 当前市值 → 以总股本折算每股参考（股价图用每股维度更直观）
    const shareYi = totalSharesYi && totalSharesYi > 0 ? totalSharesYi : null;
    const targetPerShare = (capYi?: number) =>
      capYi !== undefined && shareYi ? +(capYi / shareYi).toFixed(1) : undefined;

    // 开盘前没有当日股价时（最后一根 bar 非今日，如盘前/休市），不展示悲/合/乐分割线
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const hasTodayBar = bars.length > 0 && bars[bars.length - 1].date === todayStr;

    const markLines: MarkLineData = hasTodayBar
      ? [
          capLine(targetPerShare(target?.pessimistic), "#34d399", "悲观"),
          capLine(targetPerShare(target?.neutral), "#fbbf24", "合理"),
          capLine(targetPerShare(target?.optimistic), "#f87171", "乐观"),
        ].filter((x): x is MarkLineData[number] => x !== null)
      : [];

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
        data: ["K线", "成交量"],
        textStyle: { color: "#a1a1a1" },
        top: 0,
      },
      grid: [
        { left: 60, right: 30, top: 32, height: "58%" },
        { left: 60, right: 30, top: "74%", height: "16%" },
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
          name: "K线",
          type: "candlestick",
          data: kline,
          itemStyle: { color: "#ef4444", color0: "#22c55e", borderColor: "#ef4444", borderColor0: "#22c55e" },
          markLine: markLines.length > 0 ? { symbol: "none", data: markLines, label: { fontSize: 10 } } : undefined,
        },
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volumes,
          itemStyle: { color: "rgba(212,175,55,0.5)" },
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, target, marketCapYi, totalSharesYi]);

  return (
    <div>
      <div ref={ref} className="chart-container" />
      <div className="chart-source">前复权日 K · 虚线为目标市值折算每股参考价 · 数据源：同花顺 hithink</div>
    </div>
  );
}
