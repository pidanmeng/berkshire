"use client";

import { create } from "zustand";

interface DashboardState {
  /** 已选行业 / 标签 */
  selectedTags: string[];
  /** 已选公司 thscode 列表 */
  selectedCompanies: string[];
  /** 公司列表是否多选模式（false = 单选） */
  companyMultiSelect: boolean;
  /** 仅看自选股（行业列表顶部「自选股」开关，永远置顶） */
  watchlistOnly: boolean;

  toggleTag: (tag: string) => void;
  clearTags: () => void;

  /** 多选模式：切换某家公司选中态 */
  toggleCompany: (code: string) => void;
  /** 单选模式：仅选中该公司（再次点击同一家则取消） */
  selectCompany: (code: string) => void;
  /** 批量设置选中公司（全选用） */
  setCompanies: (codes: string[]) => void;
  clearCompanies: () => void;
  setCompanyMultiSelect: (on: boolean) => void;
  /** 切换「自选股」过滤开关 */
  toggleWatchlistOnly: () => void;
}

/**
 * 页面选择状态（标签筛选 / 公司选中与单选多选模式 / 自选股过滤）。
 * 行情数据仍由 Dashboard 轮询持有，这里只管理用户交互状态。
 */
export const useDashboardStore = create<DashboardState>((set) => ({
  selectedTags: [],
  selectedCompanies: [],
  companyMultiSelect: false,
  watchlistOnly: false,

  toggleTag: (tag) =>
    set((s) => ({
      selectedTags: s.selectedTags.includes(tag)
        ? s.selectedTags.filter((t) => t !== tag)
        : [...s.selectedTags, tag],
    })),
  clearTags: () => set({ selectedTags: [] }),

  toggleCompany: (code) =>
    set((s) => ({
      selectedCompanies: s.selectedCompanies.includes(code)
        ? s.selectedCompanies.filter((c) => c !== code)
        : [...s.selectedCompanies, code],
    })),
  selectCompany: (code) =>
    set((s) => ({
      selectedCompanies:
        s.selectedCompanies.length === 1 && s.selectedCompanies[0] === code
          ? []
          : [code],
    })),
  setCompanies: (codes) => set({ selectedCompanies: codes }),
  clearCompanies: () => set({ selectedCompanies: [] }),
  setCompanyMultiSelect: (on) =>
    set((s) => ({
      companyMultiSelect: on,
      // 切回单选时只保留第一家，避免残留多选状态
      selectedCompanies:
        on || s.selectedCompanies.length <= 1
          ? s.selectedCompanies
          : [s.selectedCompanies[0]],
    })),
  toggleWatchlistOnly: () =>
    set((s) => ({ watchlistOnly: !s.watchlistOnly })),
}));
