/**
 * 财报精读 — 入口脚本
 * 实际调用共享脚本 .trae/scripts/evaluation/evaluate.ts（公共实现）
 */

import { main as evaluateMain } from "../../../scripts/evaluation/evaluate.ts";

if (import.meta.main) evaluateMain();
