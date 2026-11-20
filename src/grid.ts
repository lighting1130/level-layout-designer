import type { Camera } from "./camera";

/** 一个格子在世界坐标中的边长（缩放 100% 时即 32 屏幕像素） */
export const CELL_SIZE = 32;
/** 每隔多少个格子画一条主网格线 */
export const MAJOR_EVERY = 10;

const COLORS = {
  background: "#1e2127",
  minor: "rgba(255,255,255,0.07)",
  major: "rgba(255,255,255,0.16)",
  axisX: "rgba(232,107,107,0.65)",
  axisY: "rgba(122,200,120,0.65)",
};

/** 细网格线在屏幕上最小间距，小于它就切换到更粗一级的网格 */
const MIN_MINOR_PX = 6;
/** 细网格线完全显现所需的屏幕间距 */
const FULL_MINOR_PX = 16;

/**
 * 只绘制当前视口可见范围内的网格线，所以无论平移到多远都是"无限"的，
 * 且每帧开销只与屏幕大小有关。
 * 缩得很小时自动按 ×MAJOR_EVERY 合并层级（LOD），避免线条过密。
 */
export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, width: number, height: number): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  // 选择当前层级：细线间距（世界单位）
  let minorStep = CELL_SIZE;
  while (minorStep * cam.zoom < MIN_MINOR_PX) minorStep *= MAJOR_EVERY;
  const majorStep = minorStep * MAJOR_EVERY;

  // 细线随间距淡入淡出，层级切换时更平滑
  const minorPx = minorStep * cam.zoom;
  const minorAlpha = Math.min(1, (minorPx - MIN_MINOR_PX) / (FULL_MINOR_PX - MIN_MINOR_PX));

  const left = cam.x;
  const top = cam.y;
  const right = cam.x + width / cam.zoom;
  const bottom = cam.y + height / cam.zoom;

  ctx.lineWidth = 1;

  const drawLines = (step: number, style: string, alpha: number, skipEvery: number) => {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = style;
    ctx.beginPath();
    const i0 = Math.ceil(left / step);
    const i1 = Math.floor(right / step);
    for (let i = i0; i <= i1; i++) {
      if (skipEvery && i % skipEvery === 0) continue;
      // +0.5 让 1px 线落在像素中心，避免发虚
      const sx = Math.round((i * step - cam.x) * cam.zoom) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    const j0 = Math.ceil(top / step);
    const j1 = Math.floor(bottom / step);
    for (let j = j0; j <= j1; j++) {
      if (skipEvery && j % skipEvery === 0) continue;
      const sy = Math.round((j * step - cam.y) * cam.zoom) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  };

  drawLines(minorStep, COLORS.minor, minorAlpha, MAJOR_EVERY);
  drawLines(majorStep, COLORS.major, 1, 0);
  ctx.globalAlpha = 1;

  // 原点坐标轴
  const origin = cam.worldToScreen(0, 0);
  ctx.lineWidth = 1.5;
  if (origin.y >= 0 && origin.y <= height) {
    ctx.strokeStyle = COLORS.axisX;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(origin.y) + 0.5);
    ctx.lineTo(width, Math.round(origin.y) + 0.5);
    ctx.stroke();
  }
  if (origin.x >= 0 && origin.x <= width) {
    ctx.strokeStyle = COLORS.axisY;
    ctx.beginPath();
    ctx.moveTo(Math.round(origin.x) + 0.5, 0);
    ctx.lineTo(Math.round(origin.x) + 0.5, height);
    ctx.stroke();
  }
}
