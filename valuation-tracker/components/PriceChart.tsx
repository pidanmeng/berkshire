"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { CompanyItem, Announcement } from "@/lib/api";

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

/** HTML 转义（公告标题进 tooltip，防注入） */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function PriceChart({
  bars,
  target,
  marketCapYi,
  totalSharesYi,
  announcements,
}: {
  bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  target: CompanyItem["targetMarketCapYi"];
  marketCapYi: number | null;
  totalSharesYi?: number | null;
  /** 公告 POI：在对应日期 K 线下方打标记，悬停显示标题，点击打开 PDF */
  announcements?: Announcement[];
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

    // 悲观/合理/乐观目标线：只要有目标市值锚点 + 总股本，就始终绘制
    // （此前要求「最后一根 bar 为今日」才画线，导致开盘前/休市时水平线不显示）
    const markLines: MarkLineData = [
      capLine(targetPerShare(target?.pessimistic), "#34d399", "悲观"),
      capLine(targetPerShare(target?.neutral), "#fbbf24", "合理"),
      capLine(targetPerShare(target?.optimistic), "#f87171", "乐观"),
    ].filter((x): x is MarkLineData[number] => x !== null);

    // 公告 POI：仅保留 K 线日期范围内的公告，在当日 K 线下方打金色标记点
    // （与巨潮公告 date 同 YYYY-MM-DD 格式直接对齐；hover 显示标题，点击打开 PDF）
    const inRange: Announcement[] = (announcements ?? []).filter((a) => dates.includes(a.date));
    const markPoints = inRange.map((a) => {
      const idx = dates.indexOf(a.date);
      const low = bars[idx].low;
      return {
        name: a.title,
        coord: [a.date, +(low * 0.965).toFixed(3)],
        value: a.title,
        symbol: "pin",
        symbolSize: 14,
        itemStyle: { color: "#f2c14e", borderColor: "#000000", borderWidth: 0.5 },
        label: { show: false },
        tooltip: {
          formatter: () =>
            `<div style="max-width:320px"><div style="color:#f2c14e;font-size:11px">${a.date} 公告</div>` +
            `<div style="font-size:12px;margin-top:3px">${esc(a.title)}</div>` +
            (a.pdfUrl ? `<div style="font-size:11px;color:#a1a1a1;margin-top:3px">点击打开公告 PDF ↗</div>` : "") +
            `</div>`,
        },
      };
    });

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
          markPoint: markPoints.length > 0
            ? { data: markPoints, animation: false }
            : undefined,
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

    // 点击公告 POI → 新标签打开公告 PDF（index 与 markPoints 数组顺序一致）
    const onClick = (params: unknown) => {
      const p = params as { componentType?: string; dataIndex?: number };
      if (p.componentType === "markPoint" && typeof p.dataIndex === "number") {
        const ann = inRange[p.dataIndex];
        if (ann?.pdfUrl) window.open(ann.pdfUrl, "_blank", "noopener,noreferrer");
      }
    };
    chart.on("click", onClick);

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    // 容器尺寸变化（侧栏折叠/面板拖拽/移动端断点切换）时自适应
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);
    return () => {
      chart.off("click", onClick);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, target, marketCapYi, totalSharesYi, announcements]);

  return (
    <div>
      <div ref={ref} className="chart-container" />
      <div className="chart-source">前复权日 K · 虚线为目标市值折算每股参考价 · 金色标记为公告（悬停查看，点击打开）· 数据源：同花顺 hithink + 巨潮</div>
    </div>
  );
}
