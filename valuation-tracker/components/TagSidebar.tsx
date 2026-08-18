"use client";

import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { CompanyItem } from "@/lib/api";
import { useDashboardStore } from "@/lib/dashboard-store";

export interface TagStat {
  name: string;
  count: number;
  avgChangePct: number | null;
}

/** 汇总每个 tag 下的公司数量与平均涨跌（排除系统前缀与公司自身名） */
export function buildTagStats(items: CompanyItem[]): TagStat[] {
  const EXCLUDE_PREFIXES = ["company", "research/", "deep-dive"];
  const companyNames = new Set(items.map((i) => i.name));
  const map = new Map<string, { count: number; sum: number; n: number }>();
  for (const it of items) {
    for (const t of it.tags) {
      if (EXCLUDE_PREFIXES.some((p) => t.startsWith(p))) continue;
      if (companyNames.has(t)) continue; // 公司自身名不作为归类标签
      const s = map.get(t) ?? { count: 0, sum: 0, n: 0 };
      s.count += 1;
      if (it.quote.changePct != null) {
        s.sum += it.quote.changePct;
        s.n += 1;
      }
      map.set(t, s);
    }
  }
  return [...map.entries()]
    .map(([name, s]) => ({
      name,
      count: s.count,
      avgChangePct: s.n > 0 ? +(s.sum / s.n).toFixed(2) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

const fmtPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
const chgClass = (v: number | null) => (v == null ? "text-slate-400" : v > 0 ? "text-[var(--fin-up)]" : v < 0 ? "text-[var(--fin-down)]" : "text-slate-400");

export default function TagSidebar({ tags }: { tags: TagStat[] }) {
  const [query, setQuery] = useState("");
  const selected = useDashboardStore((s) => s.selectedTags);
  const toggleTag = useDashboardStore((s) => s.toggleTag);
  const clearTags = useDashboardStore((s) => s.clearTags);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const base = query.trim()
    ? tags.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    : tags;

  // 多选时选中的标签置顶
  const visible = useMemo(() => {
    if (selected.length === 0) return base;
    const pinned = base.filter((t) => selectedSet.has(t.name));
    const rest = base.filter((t) => !selectedSet.has(t.name));
    return [...pinned, ...rest];
  }, [base, selected, selectedSet]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">行业 / 标签</span>
        {selected.length > 0 && (
          <button onClick={clearTags} className="text-xs text-muted-foreground hover:text-foreground">
            清除 ({selected.length})
          </button>
        )}
      </div>
      {/* 搜索 Tag */}
      <div className="relative px-3 pb-2">
        <Search className="absolute left-[22px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标签…"
          className="h-8 pl-9 text-[13px]"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="清除搜索"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="space-y-0.5 px-2 pb-3">
            {visible.length === 0 && (
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">无匹配标签</div>
            )}
            {visible.map((t) => {
              const active = selectedSet.has(t.name);
              return (
                <button
                  key={t.name}
                  onClick={() => toggleTag(t.name)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors",
                    active
                      ? "bg-[rgba(212,175,55,0.12)] text-[var(--accent-primary)]"
                      : "text-foreground hover:bg-muted/40",
                  )}
                >
                  <Check
                    className={cn("size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{t.count}</span>
                  <span className={cn("w-16 text-right font-mono text-[11px]", chgClass(t.avgChangePct))}>
                    {fmtPct(t.avgChangePct)}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
