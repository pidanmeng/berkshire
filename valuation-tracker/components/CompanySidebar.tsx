"use client";

import { useMemo, useState } from "react";
import { ListChecks, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { CompanyItem } from "@/lib/api";
import { useDashboardStore } from "@/lib/dashboard-store";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);

export default function CompanySidebar({
  items,
  mode,
}: {
  items: CompanyItem[];
  mode: "tag" | "all";
}) {
  const [query, setQuery] = useState("");
  const selected = useDashboardStore((s) => s.selectedCompanies);
  const multiSelect = useDashboardStore((s) => s.companyMultiSelect);
  const toggleCompany = useDashboardStore((s) => s.toggleCompany);
  const selectCompany = useDashboardStore((s) => s.selectCompany);
  const setCompanies = useDashboardStore((s) => s.setCompanies);
  const clearCompanies = useDashboardStore((s) => s.clearCompanies);
  const setCompanyMultiSelect = useDashboardStore((s) => s.setCompanyMultiSelect);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // 搜索公司（名称 / 代码）
  const base = query.trim()
    ? items.filter(
        (it) => it.name.toLowerCase().includes(query.toLowerCase()) || it.thscode.includes(query),
      )
    : items;

  // 多选时选中的公司置顶（单选模式保持原始顺序）
  const visible = useMemo(() => {
    if (!multiSelect || selected.length === 0) return base;
    const pinned = base.filter((it) => selectedSet.has(it.thscode));
    const rest = base.filter((it) => !selectedSet.has(it.thscode));
    return [...pinned, ...rest];
  }, [base, selected, selectedSet, multiSelect]);

  const allSelected = visible.length > 0 && visible.every((it) => selectedSet.has(it.thscode));

  const onRowClick = (code: string) => (multiSelect ? toggleCompany(code) : selectCompany(code));

  return (
    <div className="flex h-full flex-col">
      {/* 标题 + 单选/多选切换 */}
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground">
          公司（{items.length}）{mode === "tag" ? " · 当前标签" : " · 全部"}
        </span>
        <button
          onClick={() => setCompanyMultiSelect(!multiSelect)}
          title={multiSelect ? "切换到单选模式" : "切换到多选模式"}
          className={cn(
            "flex items-center gap-1 text-xs transition-colors",
            multiSelect
              ? "font-medium text-[var(--accent-primary)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ListChecks className="size-3.5" />
          多选
        </button>
      </div>

      {/* 多选模式：全选 / 清空 */}
      {multiSelect && (
        <div className="flex items-center gap-3 px-3 pb-2 text-xs">
          <button
            onClick={() => setCompanies(allSelected ? [] : visible.map((it) => it.thscode))}
            className="text-muted-foreground hover:text-foreground"
          >
            {allSelected ? "取消全选" : "全选"}
          </button>
          <button
            onClick={clearCompanies}
            className="text-muted-foreground hover:text-foreground"
          >
            清空{selected.length > 0 ? ` (${selected.length})` : ""}
          </button>
        </div>
      )}

      {/* 搜索公司 */}
      <div className="relative px-3 pb-2">
        <Search className="absolute left-[22px] top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索公司名 / 代码…"
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
              <div className="px-2 py-6 text-center text-xs text-muted-foreground">无匹配公司</div>
            )}
            {visible.map((it) => {
              const checked = selectedSet.has(it.thscode);
              return (
                <div
                  key={it.thscode}
                  onClick={() => onRowClick(it.thscode)}
                  title={
                    multiSelect
                      ? checked
                        ? "已选中（点击取消）"
                        : "点击选中加入比较"
                      : checked
                        ? "已选中（点击取消）"
                        : "点击查看详情"
                  }
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors",
                    checked ? "bg-[rgba(0,112,243,0.12)]" : "hover:bg-muted/40",
                  )}
                >
                  {multiSelect && (
                    <Checkbox
                      checked={checked}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleCompany(it.thscode)}
                      className="size-4"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-foreground">{it.name}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground">{it.thscode}</span>
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[11px]",
                      it.quote.changePct == null
                        ? "text-muted-foreground"
                        : it.quote.changePct > 0
                          ? "text-[var(--fin-up)]"
                          : it.quote.changePct < 0
                            ? "text-[var(--fin-down)]"
                            : "text-muted-foreground",
                    )}
                  >
                    {fmtPct(it.quote.changePct)}
                  </span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
