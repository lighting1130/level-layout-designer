import type { Camera } from "./camera";
import { arcCircle, arcPoints, clampSides, shapeBox, shapePolygon, type Pt, type ShapeKind } from "./shapes";

/**
 * 平滑（矢量）图形：保存几何参数而不是格子，绘制时用 Canvas 的圆弧/椭圆/折线，
 * 任意缩放都保持顺滑。width 为世界坐标下的线宽。
 */
export interface VectorShape {
  kind: "arc" | ShapeKind;
  a: Pt;
  b: Pt;
  bend: Pt | null;
  constrain: boolean;
  color: string;
  width: number;
  fill: boolean;
  /** 多边形的边数（kind 为 polygon 时） */
  sides?: number;
}

const KINDS = new Set(["arc", "line", "rect", "ellipse", "triangle", "diamond", "hexagon", "polygon"]);
const HEX = /^#[0-9a-f]{6}$/i;
const isPt = (p: any) => p && typeof p.x === "number" && typeof p.y === "number" && isFinite(p.x) && isFinite(p.y);

/** 校验从存储或工程文件读入的矢量图形 */
export function sanitizeVectors(list: unknown): VectorShape[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v: any) => v && KINDS.has(v.kind) && isPt(v.a) && isPt(v.b) && (v.bend === null || v.bend === undefined || isPt(v.bend))
      && typeof v.color === "string" && HEX.test(v.color) && typeof v.width === "number" && v.width > 0 && isFinite(v.width))
    .map((v: any) => ({
      kind: v.kind, a: { x: v.a.x, y: v.a.y }, b: { x: v.b.x, y: v.b.y }, bend: v.bend ? { x: v.bend.x, y: v.bend.y } : null,
      constrain: !!v.constrain, color: v.color.toLowerCase(), width: v.width, fill: !!v.fill,
      ...(v.kind === "polygon" ? { sides: clampSides(Number(v.sides)) } : {}),
    }));
}

export function isClosed(v: Pick<VectorShape, "kind">) {
  return v.kind !== "arc" && v.kind !== "line";
}

/** 在屏幕坐标中构建图形路径 */
function tracePath(ctx: CanvasRenderingContext2D, cam: Camera, v: VectorShape) {
  const S = (p: Pt) => cam.worldToScreen(p.x, p.y);
  ctx.beginPath();
  if (v.kind === "arc") {
    const c = v.bend ? arcCircle(v.a, v.b, v.bend) : null;
    const a = S(v.a), b = S(v.b);
    if (!c) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); return; }
    const u = S({ x: c.ux, y: c.uy });
    ctx.arc(u.x, u.y, c.r * cam.zoom, c.t0, c.t0 + c.sweep, c.sweep < 0);
    return;
  }
  if (v.kind === "ellipse") {
    const { x0, y0, w, h } = shapeBox(v.a, v.b, v.constrain);
    const c = S({ x: x0 + w / 2, y: y0 + h / 2 });
    ctx.ellipse(c.x, c.y, (w / 2) * cam.zoom, (h / 2) * cam.zoom, 0, 0, Math.PI * 2);
    return;
  }
  const { pts, closed } = shapePolygon(v.kind, v.a, v.b, v.constrain, v.sides);
  pts.forEach((p, n) => { const q = S(p); n ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
  if (closed) ctx.closePath();
}

export function drawVector(ctx: CanvasRenderingContext2D, cam: Camera, v: VectorShape, alpha = 1) {
  tracePath(ctx, cam, v);
  ctx.globalAlpha = alpha;
  if (v.fill && isClosed(v)) {
    ctx.fillStyle = v.color;
    ctx.fill();
  }
  ctx.strokeStyle = v.color;
  ctx.lineWidth = Math.max(1, v.width * cam.zoom);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawVectors(ctx: CanvasRenderingContext2D, cam: Camera, list: VectorShape[], alpha = 1) {
  for (const v of list) drawVector(ctx, cam, v, alpha);
}

/** 图形轮廓的采样点（用于命中测试） */
function outline(v: VectorShape): { pts: Pt[]; closed: boolean } {
  if (v.kind === "arc") return { pts: v.bend ? arcPoints(v.a, v.b, v.bend) : [v.a, v.b], closed: false };
  return shapePolygon(v.kind, v.a, v.b, v.constrain, v.sides);
}

/** 世界坐标点 (x, y) 是否碰到图形（线条附近 tol 范围内，或在填充区域内） */
export function hitVector(v: VectorShape, x: number, y: number, tol: number): boolean {
  const { pts, closed } = outline(v);
  const r = tol + v.width / 2;
  const segs = closed ? pts.length : pts.length - 1;
  for (let n = 0; n < segs; n++) {
    const p = pts[n], q = pts[(n + 1) % pts.length];
    const dx = q.x - p.x, dy = q.y - p.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((x - p.x) * dx + (y - p.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (Math.hypot(p.x + dx * t - x, p.y + dy * t - y) <= r) return true;
  }
  if (v.fill && closed) {
    let inside = false;
    for (let n = 0, m = pts.length - 1; n < pts.length; m = n++) {
      const p = pts[n], q = pts[m];
      if ((p.y > y) !== (q.y > y) && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
    }
    return inside;
  }
  return false;
}
