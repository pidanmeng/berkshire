"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { Loader2, RefreshCw, Calendar } from "lucide-react";
import type { DarkTradeHistoryResponse, DarkTradeHistoryPoint } from "@/lib/api";
import { getDarkTradeHistory } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** 金额格式化（元 → 亿/万） */
function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return `${v.toFixed(2)}元`;
}

const fmtDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** A 股红涨绿跌：正数红色，负数绿色 */
const signColor = (v: number) => (v > 0 ? "var(--fin-up)" : v < 0 ? "var(--fin-down)" : "var(--fin-flat)");

/** 暗盘资金 / 主力净流入走势（echarts 面积图） */
function FundChart({ points }: { points: DarkTradeHistoryPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart = echarts.init(ref.current);
    const dates = points.map((p) => fmtDate(p.date));
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,17,17,0.96)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
        valueFormatter: (v: unknown) => fmtMoney(Number(v)),
      },
      legend: { data: ["暗盘资金", "主力净流入"], textStyle: { color: "#a1a1a1" }, top: 0 },
      grid: { left: 70, right: 30, top: 32, bottom: 24 },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: "#333333" } },
        axisLabel: { color: "#666666" },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#666666", fontFamily: "JetBrains Mono, Consolas, monospace", formatter: (v: number) => fmtMoney(v) },
        splitLine: { lineStyle: { color: "#262626", type: "dashed" } },
      },
      series: [
        {
          name: "暗盘资金",
          type: "line",
          data: points.map((p) => p.row.darkFund),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#f2c14e" },
          itemStyle: { color: "#f2c14e" },
          areaStyle: { color: "rgba(242,193,78,0.12)" },
        },
        {
          name: "主力净流入",
          type: "line",
          data: points.map((p) => p.row.mainNet),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#a78bfa" },
          itemStyle: { color: "#a78bfa" },
          areaStyle: { color: "rgba(167,139,250,0.12)" },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [points]);

  return <div ref={ref} className="h-[340px] w-full" />;
}

/** 涨幅走势（%） */
function ChangeChart({ points }: { points: DarkTradeHistoryPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || points.length === 0) return;
    const chart = echarts.init(ref.current);
    const dates = points.map((p) => fmtDate(p.date));
    const colors = points.map((p) => (p.row.changePct >= 0 ? "#ef4444" : "#22c55e"));
    chart.setOption({
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(17,17,17,0.96)",
        borderColor: "#333333",
        textStyle: { color: "#f5f5f5" },
        valueFormatter: (v: unknown) => `${Number(v).toFixed(2)}%`,
      },
      grid: { left: 60, right: 30, top: 20, bottom: 24 },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { lineStyle: { color: "#333333" } },
        axisLabel: { color: "#666666" },
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#666666", fontFamily: "JetBrains Mono, Consolas, monospace", formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { color: "#262626", type: "dashed" } },
      },
      series: [
        {
          name: "涨幅",
          type: "bar",
          data: points.map((p, i) => ({ value: p.row.changePct, itemStyle: { color: colors[i] } })),
          barMaxWidth: 18,
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [points]);

  return <div ref={ref} className="h-[220px] w-full" />;
}

export default function DarkTradeHistory({
  code,
  initial,
}: {
  code: string;
  initial: DarkTradeHistoryResponse | null;
}) {
  const [resp, setResp] = useState<DarkTradeHistoryResponse | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDarkTradeHistory(code);
      setResp(data);
    } catch {
      setError("历史数据加载失败（后端不可达或上游无数据）");
    } finally {
      setLoading(false);
    }
  }, [code]);

  const points = resp?.items ?? [];
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const totalDarkFund = points.reduce((s, p) => s + p.row.darkFund, 0);
  const totalMainNet = points.reduce((s, p) => s + p.row.mainNet, 0);

  return (
    <div className="space-y-4">
      {/* 头部统计 */}
      <section className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3 text-sm">
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <Calendar className="size-4" style={{ color: "var(--accent-primary)" }} />
          {code}
        </span>
        <span className="text-[var(--text-muted)]">
          共 <span className="font-bold text-[var(--text-primary)]">{points.length}</span> 个交易日
          <span className="ml-2 text-[11px]">
            {resp?.startDate ? `${fmtDate(resp.startDate)} ~ ${fmtDate(resp.endDate)}` : ""}
          </span>
        </span>
        <span style={{ color: signColor(totalDarkFund) }}>
          暗盘资金累计 <span className="font-semibold">{fmtMoney(totalDarkFund)}</span>
        </span>
        <span style={{ color: signColor(totalMainNet) }}>
          主力净流入累计 <span className="font-semibold">{fmtMoney(totalMainNet)}</span>
        </span>
        {latest && (
          <span className="text-[var(--text-muted)]">
            最新：{latest.row.price.toFixed(2)} 元
            <span className="font-semibold" style={{ color: signColor(latest.row.changePct) }}>
              {latest.row.changePct > 0 ? "+" : ""}
              {latest.row.changePct.toFixed(2)}%
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {resp?.pageHint != null && (
            <span className="text-[11px] text-[var(--text-muted)]">页码 hint：第 {resp.pageHint} 页</span>
          )}
          <Button size="sm" variant="outline" disabled={loading} onClick={load}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            刷新
          </Button>
        </div>
      </section>

      {error && (
        <div className="status-bar">
          <span className="dot err" />
          <span style={{ color: "var(--accent-danger)" }}>{error}</span>
        </div>
      )}

      {loading && (
        <section className="border border-[var(--border-default)] bg-[var(--bg-card)] px-4 py-3 text-sm" style={{ color: "var(--accent-primary)" }}>
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            正在从东财逐日拉取历史数据（利用页码 hint 加速）…
          </span>
        </section>
      )}

      {!loading && points.length === 0 && (
        <section className="flex flex-col items-center justify-center border border-[var(--border-default)] bg-[var(--bg-card)] py-24 text-[var(--text-muted)]">
          <p className="text-sm">该时间段内未找到 {code} 的暗盘数据</p>
        </section>
      )}

      {!loading && points.length > 0 && (
        <>
          <section className="border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-2 border-l-[3px] border-[var(--accent-primary)] pl-2.5 text-sm font-semibold text-[var(--text-primary)]">
              暗盘资金 / 主力净流入走势
            </h3>
            <FundChart points={points} />
          </section>

          <section className="border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h3 className="mb-2 border-l-[3px] border-[var(--accent-primary)] pl-2.5 text-sm font-semibold text-[var(--text-primary)]">
              涨幅走势（%）
            </h3>
            <ChangeChart points={points} />
          </section>

          <section className="overflow-x-auto border border-[var(--border-default)] bg-[var(--bg-card)]">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">历史数据明细</h3>
            </div>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
                  {["日期", "暗盘资金", "明盘资金", "主力净流入", "活跃度", "股价", "涨幅"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] ${i === 0 ? "text-left" : "text-right"}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.date} className="border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--bg-card-hover)]">
                    <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-muted)]">{fmtDate(p.date)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: signColor(p.row.darkFund) }}>
                      {fmtMoney(p.row.darkFund)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: signColor(p.row.brightFund) }}>
                      {fmtMoney(p.row.brightFund)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: signColor(p.row.mainNet) }}>
                      {fmtMoney(p.row.mainNet)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {p.row.activity.toFixed(2)}%
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {p.row.price.toFixed(2)}
                    </td>
                    <td
                      className="px-3 py-1.5 text-right font-mono tabular-nums font-medium"
                      style={{ color: signColor(p.row.changePct) }}
                    >
                      {p.row.changePct > 0 ? "+" : ""}
                      {p.row.changePct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
