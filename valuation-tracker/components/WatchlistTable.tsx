"use client";

import { useMemo, useState } from "react";
import type { CompanyItem } from "@/lib/api";
import CapZoneBadge from "./CapZoneBadge";

type SortKey = "name" | "marketCapYi" | "price" | "changePct" | "peTtm" | "composite" | "marginVsPess";
type SortDir = "asc" | "desc";

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

/** 取排序键对应的值（price/changePct/peTtm 在 quote，marginVsPess 在 zone） */
function sortValue(it: CompanyItem, key: SortKey): number | string | null {
  switch (key) {
    case "price": return it.quote.price;
    case "changePct": return it.quote.changePct;
    case "peTtm": return it.quote.peTtm;
    case "marginVsPess": return it.zone.marginVsPess;
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
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "asc"); }
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
            <th>目标市值（悲/合/乐）</th>
            <th>安全边际</th>
            <th>质量</th>
            {col("composite", "综合分")}
            <th>基本面</th>
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
                <td className="num">
                  {it.targetMarketCapYi
                    ? `${fmtYi(it.targetMarketCapYi.pessimistic ?? null)} / ${fmtYi(it.targetMarketCapYi.neutral ?? null)} / ${fmtYi(it.targetMarketCapYi.optimistic ?? null)}`
                    : "—"}
                </td>
                <td><CapZoneBadge zone={it.zone.zone} /></td>
                <td><QualityBadge v={it.qualityVerdict} /></td>
                <td className="num">{fmtNum(it.composite)}</td>
                <td>
                  {it.needsUpdate === true
                    ? <span className="badge badge-red">需更新</span>
                    : it.needsUpdate === false
                      ? <span className="badge badge-green">已最新</span>
                      : <span className="badge badge-muted">待检测</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
