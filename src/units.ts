import { CELL_SIZE } from "./grid";
import { t } from "./i18n";

/**
 * 现实尺寸：一个基础格子（缩放 100% 时 32 像素的那一级）代表多少米，默认 1 米。
 * 格子放大细分、缩小合并时，每级是上一级的 1/10 或 10 倍，米数跟着换算。
 */
const KEY = "level-layout-designer.meterspercell.v1";
export const DEFAULT_METERS_PER_CELL = 1;

export const clampMeters = (v: number) => (isFinite(v) && v > 0 ? Math.min(1e6, Math.max(1e-6, v)) : DEFAULT_METERS_PER_CELL);

let metersPerCell = DEFAULT_METERS_PER_CELL;
try {
  const v = Number(localStorage.getItem(KEY));
  if (v > 0) metersPerCell = clampMeters(v);
} catch { /* 忽略 */ }

export const getMetersPerCell = () => metersPerCell;
export function setMetersPerCell(v: number) {
  metersPerCell = clampMeters(v);
  try { localStorage.setItem(KEY, String(metersPerCell)); } catch { /* 忽略 */ }
}

/** 世界坐标长度 -> 米 */
export const worldToMeters = (w: number) => (w / CELL_SIZE) * metersPerCell;

/**
 * 把米数格式化成合适的单位（km / m / cm / mm）。
 * step 是这个数字的精度（米），决定用什么单位和保留几位小数，比如刻度间隔。
 */
export function formatLength(m: number, step = Math.abs(m) || 1): string {
  const ref = Math.abs(step);
  // 单位看数值本身的大小（但不小于精度），小数位看精度；多余的 0 去掉
  const mag = Math.max(Math.abs(m), ref);
  const [unit, f] = mag >= 1000 && ref >= 1 ? ["km", 1000] : mag >= 1 ? ["m", 1] : mag >= 0.01 ? ["cm", 0.01] : ["mm", 0.001];
  const v = m / f, s = ref / f;
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(s) - 1e-9)));
  let text = v.toFixed(decimals);
  if (text.includes(".")) text = text.replace(/\.?0+$/, "");
  if (text === "-0") text = "0";
  return `${text} ${unit}`;
}

/** 比例说明，如 “1 格 = 1 m” */
export const scaleText = () => t("1 格 = {len}", { len: formatLength(metersPerCell, metersPerCell) });
