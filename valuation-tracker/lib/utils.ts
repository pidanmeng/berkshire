import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** A 股 6 位代码 → thscode（沪 6 开头→SH，北交所 4/8/9 开头→BJ，其余→SZ） */
export function codeToThscode(code: string): string {
  const c = code.trim().toUpperCase();
  if (c.startsWith("6")) return `${c}.SH`;
  if (/^[489]/.test(c)) return `${c}.BJ`;
  return `${c}.SZ`;
}

/** thscode → 6 位代码（如 600519.SH → 600519） */
export function thscodeToCode(thscode: string): string {
  return thscode.split(".")[0] ?? thscode;
}
