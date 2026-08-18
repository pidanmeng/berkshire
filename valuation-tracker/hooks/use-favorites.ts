"use client";

import { useEffect, useMemo, useState } from "react";

/** 自选股收藏（thscode 数组）localStorage key */
const FAVORITES_KEY = "valuation-favorite-stocks";

/**
 * 自选股收藏：localStorage 持久化 + 收藏集合派生。
 * 仅浏览器端可用；存储不可用时静默降级为内存态（如隐私模式）。
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>([]);

  // 首次挂载后从 localStorage 恢复（服务端渲染时为初始空态）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setFavorites(parsed.filter((c): c is string => typeof c === "string"));
        }
      }
    } catch {
      // 存储不可用时忽略（如隐私模式）
    }
  }, []);

  // 切换收藏状态：先算 next 并写 localStorage，再 setState（副作用不进 updater，避免 StrictMode 双调）
  const toggleFavorite = (code: string) => {
    const next = favorites.includes(code)
      ? favorites.filter((c) => c !== code)
      : [...favorites, code];
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用时忽略（如隐私模式）
    }
    setFavorites(next);
  };

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  return { favorites, favoriteSet, toggleFavorite };
}
