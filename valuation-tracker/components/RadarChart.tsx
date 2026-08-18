"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

const DIMS: { key: string; label: string }[] = [
  { key: "capability", label: "能力圈" },
  { key: "moat", label: "护城河" },
  { key: "business_model", label: "生意模式" },
  { key: "management", label: "管理层" },
  { key: "inversion", label: "反向清单" },
  { key: "historical", label: "历史类比" },
];

export default function RadarChart({
  scores,
  series,
  height = 300,
}: {
  scores?: Record<string, number> | null;
  /** 多公司比较：series = [{ name, scores }] */
  series?: { name: string; scores: Record<string, number> }[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;

    const indicators = DIMS.map((d) => ({
      name: d.label,
      max: 10,
      axisLabel: { color: "#666666" },
    }));

    const palettes = ["#f2c14e", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#22d3ee"];
    const list = series && series.length > 0
      ? series
      : scores
        ? [{ name: "", scores }]
        : [];

    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: { trigger: "item" },
      legend: list.length > 1
        ? { top: 0, textStyle: { color: "#a1a1a1" }, data: list.map((s) => s.name) }
        : undefined,
      radar: {
        indicator: indicators,
        radius: "62%",
        center: ["50%", list.length > 1 ? "55%" : "50%"],
        axisName: { color: "#a1a1a1", fontSize: 11 },
        splitArea: { areaStyle: { color: ["rgba(242,193,78,0.03)", "rgba(242,193,78,0.06)"] } },
        splitLine: { lineStyle: { color: "#262626" } },
        axisLine: { lineStyle: { color: "#333333" } },
      },
      series: [
        {
          type: "radar",
          data: list.map((s, i) => ({
            name: s.name,
            value: DIMS.map((d) => s.scores?.[d.key] ?? null),
            areaStyle: list.length > 1 ? undefined : { opacity: 0.18 },
            lineStyle: { color: palettes[i % palettes.length], width: 2 },
            itemStyle: { color: palettes[i % palettes.length] },
            symbolSize: 4,
          })),
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    // 容器尺寸变化（侧栏折叠/面板拖拽/移动端断点切换）时自适应
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, series, height]);

  return (
    <div>
      <div ref={ref} style={{ width: "100%", height }} />
      <div className="chart-source">六维评分 0-10 分 · 综合分为系统加权计算</div>
    </div>
  );
}
