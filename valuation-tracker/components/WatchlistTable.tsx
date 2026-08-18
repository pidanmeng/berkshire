"use client";

import { useMemo, useState } from "react";
import type { CompanyItem } from "@/lib/api";
import CapZoneBadge from "./CapZoneBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SortKey =
  | "name"
  | "marketCapYi"
  | "price"
  | "changePct"
  | "peTtm"
  | "composite"
  | "marginVsPess"
  | "distanceToNeutral"
  | "distanceToOpt"
  | "zone"
  | "qualityScore"
  | "needsUpdate";
type SortDir = "asc" | "desc";

/** 安全边际分档排序优先级：低估在前 */
const ZONE_ORDER: Record<string, number> = {
  deep_undervalued: 0,
  undervalued: 1,
  fair: 2,
  overvalued: 3,
  no_anchor: 4,
};

/** 质量档位排序优先级：GREEN 在前 */
const QUALITY_ORDER: Record<string, number> = {
  GREEN: 0,
  YELLOW: 1,
  RED: 2,
};

/** 基本面排序优先级：需更新在前 */
function needsUpdateRank(v: boolean | null): number {
  return v === true ? 0 : v === false ? 1 : 2;
}

const fmtYi = (v: number | null) => (v == null ? "—" : `${Math.round(v).toLocaleString()} 亿`);
const fmtPrice = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const fmtPe = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtNum = (v: number | null) => (v == null ? "—" : v.toFixed(1));

function chgClass(v: number | null): string {
  if (v == null) return "chg-flat";
  return v > 0 ? "chg-up" : v < 0 ? "chg-down" : "chg-flat";
}

function QualityBadge({ v }: { v: string | null }) {
  if (!v) return <span className="badge badge-muted">—</span>;
  const cls = v === "GREEN" ? "badge-green" : v === "RED" ? "badge-red" : "badge-yellow";
  return <span className={`badge ${cls}`}>{v}</span>;
}

/** 取排序键对应的值（price/changePct/peTtm 在 quote，marginVsPess 等在 zone，其余直接取字段） */
function sortValue(it: CompanyItem, key: SortKey): number | string | null {
  switch (key) {
    case "price": return it.quote.price;
    case "changePct": return it.quote.changePct;
    case "peTtm": return it.quote.peTtm;
    case "marginVsPess": return it.zone.marginVsPess;
    case "distanceToNeutral": return it.zone.distanceToNeutral;
    case "distanceToOpt": return it.zone.distanceToOpt;
    case "zone": return ZONE_ORDER[it.zone.zone] ?? 99;
    case "qualityScore": {
      const rank =
        it.qualityVerdict === "GREEN" || it.qualityVerdict === "YELLOW" || it.qualityVerdict === "RED"
          ? QUALITY_ORDER[it.qualityVerdict]
          : 3;
      return rank * 100 + (it.qualityScore ?? 0);
    }
    case "needsUpdate": return needsUpdateRank(it.needsUpdate);
    default: {
      const v = it[key];
      return typeof v === "string" || typeof v === "number" ? v : null;
    }
  }
}

/** 看板表格（纯展示 + 排序 + 行点击选中，tag 筛选/轮询由外层容器负责） */
export default function WatchlistTable({
  items,
  selectedCodes,
  onSelect,
}: {
  items: CompanyItem[];
  selectedCodes: string[];
  /** 行点击回调（单选/多选语义由外层根据模式决定） */
  onSelect: (code: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("marginVsPess");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb, "zh") * dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [items, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      // 质量分默认高分优先，其余默认升序（低估/需更新优先）
      setSortDir(key === "qualityScore" ? "desc" : "asc");
    }
  };

  const col = (key: SortKey, label: string) => (
    <th className={sortKey === key ? "sorted-col" : ""} onClick={() => toggleSort(key)}>{label}</th>
  );

  const toggleSelect = (code: string) => onSelect(code);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {col("name", "公司")}
            <th>行业 / 细分</th>
            {col("price", "现价")}
            {col("changePct", "涨跌")}
            {col("marketCapYi", "总市值")}
            {col("peTtm", "PE-TTM")}
            {col("marginVsPess", "vs 悲观目标")}
            {col("distanceToNeutral", "vs 合理目标")}
            {col("distanceToOpt", "vs 乐观目标")}
            {col("zone", "安全边际")}
            {col("qualityScore", "质量")}
            {col("composite", "综合分")}
            {col("needsUpdate", "基本面")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((it) => {
            const selected = selectedCodes.includes(it.thscode);
            return (
              <tr
                key={it.thscode}
                onClick={() => toggleSelect(it.thscode)}
                className={selected ? "row-selected" : ""}
                title={selected ? "已选中（点击取消）" : "点击选中加入比较"}
              >
                <td>
                  <span className="co-name">{it.name}</span>
                  {(it.updateCount ?? 0) > 0 && (
                    <span className="badge badge-primary" style={{ marginLeft: 6, fontSize: 10 }}>更新 {it.updateCount}</span>
                  )}
                  <div className="co-code">{it.thscode}</div>
                </td>
                <td className="row-tags">
                  {it.industry && <span className="mini-tag">{it.industry}</span>}
                  {it.subIndustry && <span className="mini-tag">{it.subIndustry}</span>}
                </td>
                <td className="num">{fmtPrice(it.quote.price)}</td>
                <td className={`num ${chgClass(it.quote.changePct)}`}>{fmtPct(it.quote.changePct)}</td>
                <td className="num">{fmtYi(it.marketCapYi)}</td>
                <td className="num">{fmtPe(it.quote.peTtm)}</td>
                <td className="num">{it.zone.marginVsPess != null ? `${(it.zone.marginVsPess * 100).toFixed(1)}%` : "—"}</td>
                <td className="num">{it.zone.distanceToNeutral != null ? `${(it.zone.distanceToNeutral * 100).toFixed(1)}%` : "—"}</td>
                <td className="num">{it.zone.distanceToOpt != null ? `${(it.zone.distanceToOpt * 100).toFixed(1)}%` : "—"}</td>
                <td><CapZoneBadge zone={it.zone.zone} /></td>
                <td><QualityBadge v={it.qualityVerdict} /></td>
                <td className="num">{fmtNum(it.composite)}</td>
                <td>
                  {it.needsUpdate === true ? (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="badge badge-red">需更新</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <ul className="space-y-1">
                            {(it.fundamentalItems ?? []).length > 0 ? (
                              it.fundamentalItems!.map((f, i) => (
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
                  ) : it.needsUpdate === false ? (
                    <span className="badge badge-green">已最新</span>
                  ) : (
                    <span className="badge badge-muted">待检测</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
