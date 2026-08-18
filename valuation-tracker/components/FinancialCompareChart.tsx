"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { Financials } from "@/lib/api";

/** 参与对比的指标（% 类直接显示，OCF/净利为倍数） */
const METRICS: { key: keyof Financials; label: string; suffix: string }[] = [
  { key: "roe", label: "ROE", suffix: "%" },
  { key: "grossMargin", label: "毛利率", suffix: "%" },
  { key: "netMargin", label: "净利率", suffix: "%" },
  { key: "assetLiabilityRatio", label: "资产负债率", suffix: "%" },
  { key: "ocfToNi", label: "OCF/净利", suffix: "x" },
  { key: "revenueYoy", label: "营收同比", suffix: "%" },
  { key: "netProfitYoy", label: "净利同比", suffix: "%" },
];

/**
 * 基本面更新对比图 — 上次研究（基线 financials）vs 本次更新（update financials）
 * 分组柱状图，每项指标两根柱子，数值标注在柱顶。
 */
export default function FinancialCompareChart({
  baseline,
  update,
  baselineLabel = "上次研究",
  updateLabel = "本次更新",
  height = 300,
}: {
  baseline?: Financials | null;
  update?: Financials | null;
  baselineLabel?: string;
  updateLabel?: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);

    const cats = METRICS.map((m) => m.label);
    const baseVals = METRICS.map((m) => (baseline && typeof baseline[m.key] === "number" ? baseline[m.key] as number : null));
    const updVals = METRICS.map((m) => (update && typeof update[m.key] === "number" ? update[m.key] as number : null));

    const series: echarts.SeriesOption[] = [
      {
        name: baselineLabel,
        type: "bar",
        barMaxWidth: 22,
        itemStyle: { color: "#d4af37", borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: "top", color: "#a1a1a1", fontSize: 10, formatter: (p) => (p.value == null ? "" : `${p.value}`) },
        data: baseVals,
      },
      {
        name: updateLabel,
        type: "bar",
        barMaxWidth: 22,
        itemStyle: { color: "#34d399", borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: "top", color: "#a1a1a1", fontSize: 10, formatter: (p) => (p.value == null ? "" : `${p.value}`) },
        data: updVals,
      },
    ];

    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: unknown) => (v == null ? "—" : `${v}`),
      },
      legend: {
        top: 0,
        textStyle: { color: "#a1a1a1" },
        data: [baselineLabel, updateLabel],
      },
      grid: { top: 40, left: 8, right: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: cats,
        axisLine: { lineStyle: { color: "#333333" } },
        axisLabel: { color: "#a1a1a1", fontSize: 11 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#262626" } },
        axisLabel: { color: "#666666", fontSize: 10 },
      },
      series,
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline, update, baselineLabel, updateLabel]);

  return (
    <div>
      <div ref={ref} style={{ width: "100%", height }} />
      <div className="chart-source">注：数值为 financials 块原值；资产负债率越高风险越大，其余指标越高越优（OCF/净利 ≥1 为健康）。</div>
    </div>
  );
}
