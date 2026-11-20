import type { Camera } from "./camera";

/** 一个基础格子在世界坐标中的边长（缩放 100% 时即 32 屏幕像素） */
export const CELL_SIZE = 32;
/** 每一级网格细分/合并的倍数：每 10 格一条主线，放大后每格再分成 10 小格 */
export const SUBDIVISION = 10;

const BACKGROUND = "#1e2127";
const LINE_RGB = "255,255,255";
const AXIS_X = "rgba(232,107,107,0.7)";
const AXIS_Y = "rgba(122,200,120,0.7)";

/** 线间距小于它就不画（太密） */
const MIN_PX = 6;
/** 线间距达到它时线条最清晰 */
const STRONG_PX = 600;
const MIN_ALPHA = 0.05;
const MAX_ALPHA = 0.28;

/** 线条透明度只由它在屏幕上的间距决定，因此任意缩放下各级网格都能平滑淡入淡出 */
function alphaForSpacing(px: number): number {
  if (px < MIN_PX) return 0;
  const t = Math.min(1, Math.log(px / MIN_PX) / Math.log(STRONG_PX / MIN_PX));
  const fadeIn = Math.min(1, (px - MIN_PX) / MIN_PX); // 刚出现时从 0 淡入
  return (MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * t) * fadeIn;
}

/**
 * 当前视口下最细一级网格的层级 k：间距 = CELL_SIZE * SUBDIVISION^k（k 可为负，即细分）。
 * k 没有上下限，所以网格既可以无限合并，也可以无限细分。
 */
export function finestLevel(zoom: number): number {
  return Math.ceil(Math.log(MIN_PX / (CELL_SIZE * zoom)) / Math.log(SUBDIVISION));
}

export function levelStep(k: number): number {
  return CELL_SIZE * Math.pow(SUBDIVISION, k);
}

/**
 * 只绘制当前视口可见范围内的网格线，所以无论平移到多远都是"无限"的。
 * 同时绘制 3 个相邻层级（细、中、粗），每级透明度随屏幕间距变化：
 * 放大时更细的格子逐渐浮现，缩小时细格子逐渐消失，没有尽头。
 */
export function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
}

/** 画笔使用的格子层级：屏幕上至少 BRUSH_MIN_PX 大的最细一级，所以"看到多大的格子就画多大的格子" */
const BRUSH_MIN_PX = 16;
export function brushLevel(zoom: number): number {
  return Math.ceil(Math.log(BRUSH_MIN_PX / (CELL_SIZE * zoom)) / Math.log(SUBDIVISION) - 1e-9);
}

/** 导出图片时可以换成深色线条（浅色背景）、不画原点坐标轴 */
export interface GridStyle { lineRGB?: string; axes?: boolean }

export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, width: number, height: number, style: GridStyle = {}): void {
  const lineRGB = style.lineRGB ?? LINE_RGB;
  const left = cam.x;
  const top = cam.y;
  const right = cam.x + width / cam.zoom;
  const bottom = cam.y + height / cam.zoom;

  const k0 = finestLevel(cam.zoom);
  const LEVELS = 3;
  ctx.lineWidth = 1;

  for (let k = k0; k < k0 + LEVELS; k++) {
    const step = levelStep(k);
    const alpha = alphaForSpacing(step * cam.zoom);
    if (alpha <= 0) continue;
    // 最粗一级画全部线；其它级跳过与更粗一级重合的线，避免叠加变亮
    const skip = k < k0 + LEVELS - 1 ? SUBDIVISION : 0;
    ctx.strokeStyle = `rgba(${lineRGB},${alpha.toFixed(3)})`;
    ctx.beginPath();
    const i0 = Math.ceil(left / step);
    const i1 = Math.floor(right / step);
    for (let i = i0; i <= i1; i++) {
      if (skip && i % skip === 0) continue;
      // +0.5 让 1px 线落在像素中心，避免发虚
      const sx = Math.round((i * step - cam.x) * cam.zoom) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    const j0 = Math.ceil(top / step);
    const j1 = Math.floor(bottom / step);
    for (let j = j0; j <= j1; j++) {
      if (skip && j % skip === 0) continue;
      const sy = Math.round((j * step - cam.y) * cam.zoom) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  }

  // 原点坐标轴
  if (style.axes === false) return;
  const origin = cam.worldToScreen(0, 0);
  ctx.lineWidth = 1.5;
  if (origin.y >= 0 && origin.y <= height) {
    ctx.strokeStyle = AXIS_X;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(origin.y) + 0.5);
    ctx.lineTo(width, Math.round(origin.y) + 0.5);
    ctx.stroke();
  }
  if (origin.x >= 0 && origin.x <= width) {
    ctx.strokeStyle = AXIS_Y;
    ctx.beginPath();
    ctx.moveTo(Math.round(origin.x) + 0.5, 0);
    ctx.lineTo(Math.round(origin.x) + 0.5, height);
    ctx.stroke();
  }
}
