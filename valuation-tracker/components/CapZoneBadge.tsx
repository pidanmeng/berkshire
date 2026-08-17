"use client";

import type { CapZone } from "@/lib/api";

const ZONE_LABEL: Record<CapZone, string> = {
  deep_undervalued: "深度低估",
  undervalued: "低估区间",
  fair: "合理区间",
  overvalued: "高估区间",
  no_anchor: "无估值锚点",
};

export default function CapZoneBadge({ zone }: { zone: CapZone }) {
  return <span className={`badge zone-${zone}`}>{ZONE_LABEL[zone]}</span>;
}
