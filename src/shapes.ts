/** 把几何图形（世界坐标）栅格化成某一层级的格子列表 */
export interface Pt { x: number; y: number }
export interface CellIJ { i: number; j: number }

export type ShapeKind = "line" | "rect" | "ellipse" | "triangle" | "diamond" | "hexagon";

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  line: "直线",
  rect: "矩形",
  ellipse: "圆/椭圆",
  triangle: "三角形",
  diamond: "菱形",
  hexagon: "六边形",
};

/** 单次图形最多生成的格子数，防止在极小的格子层级上画出超大图形卡死 */
export const MAX_SHAPE_CELLS = 200_000;

export class TooManyCellsError extends Error {}

/** 由拖拽的两个角点得到图形的轮廓点（闭合图形不重复首点）。constrain = 按住 Shift：正方形/正圆/正多边形 */
export function shapePolygon(kind: ShapeKind, a: Pt, b: Pt, constrain: boolean): { pts: Pt[]; closed: boolean } {
  if (kind === "line") {
    if (constrain) b = snapAngle(a, b);
    return { pts: [a, b], closed: false };
  }
  let x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (constrain) {
    const m = Math.max(w, h);
    if (b.x < a.x) x0 = a.x - m;
    if (b.y < a.y) y0 = a.y - m;
    w = h = m;
  }
  const cx = x0 + w / 2, cy = y0 + h / 2;
  switch (kind) {
    case "rect":
      return { pts: [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }], closed: true };
    case "triangle":
      return { pts: [{ x: cx, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }], closed: true };
    case "diamond":
      return { pts: [{ x: cx, y: y0 }, { x: x0 + w, y: cy }, { x: cx, y: y0 + h }, { x: x0, y: cy }], closed: true };
    case "hexagon": {
      const pts: Pt[] = [];
      for (let n = 0; n < 6; n++) {
        const t = (Math.PI / 3) * n;
        pts.push({ x: cx + (w / 2) * Math.cos(t), y: cy + (h / 2) * Math.sin(t) });
      }
      return { pts, closed: true };
    }
    case "ellipse": {
      const pts: Pt[] = [];
      const N = 180;
      for (let n = 0; n < N; n++) {
        const t = (2 * Math.PI * n) / N;
        pts.push({ x: cx + (w / 2) * Math.cos(t), y: cy + (h / 2) * Math.sin(t) });
      }
      return { pts, closed: true };
    }
  }
}

function snapAngle(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + len * Math.cos(ang), y: a.y + len * Math.sin(ang) };
}

/**
 * 过起点、终点和弯曲控制点的圆弧。三点共线时退化为直线。
 * 返回弧线上的采样点。
 */
export function arcPoints(start: Pt, end: Pt, bend: Pt): Pt[] {
  const { x: ax, y: ay } = start, { x: bx, y: by } = bend, { x: cx, y: cy } = end;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const chord = Math.hypot(cx - ax, cy - ay);
  // 控制点离弦线太近（几乎是直线）时直接画直线
  const dist = Math.abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay)) / (chord || 1);
  if (Math.abs(d) < 1e-12 || dist < chord * 0.01) return [start, end];
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  const t0 = Math.atan2(ay - uy, ax - ux);
  const tb = Math.atan2(by - uy, bx - ux);
  const t1 = Math.atan2(cy - uy, cx - ux);
  // 选择经过控制点的那一侧
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(t1 - t0);
  if (norm(tb - t0) > sweep) sweep -= 2 * Math.PI;
  const N = Math.max(16, Math.ceil(Math.abs(sweep) * 64));
  const pts: Pt[] = [];
  for (let n = 0; n <= N; n++) {
    const t = t0 + (sweep * n) / N;
    pts.push({ x: ux + r * Math.cos(t), y: uy + r * Math.sin(t) });
  }
  pts[0] = start;
  pts[N] = end;
  return pts;
}

/** 沿折线经过的所有格子（格子边长 s） */
export function rasterizeStroke(pts: Pt[], closed: boolean, s: number): CellIJ[] {
  const seen = new Set<string>();
  const out: CellIJ[] = [];
  const add = (x: number, y: number) => {
    const i = Math.floor(x / s), j = Math.floor(y / s);
    const key = i + "," + j;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ i, j });
    if (out.length > MAX_SHAPE_CELLS) throw new TooManyCellsError();
  };
  const segs = closed ? pts.length : pts.length - 1;
  if (pts.length === 1) add(pts[0].x, pts[0].y);
  for (let n = 0; n < segs; n++) {
    const p = pts[n], q = pts[(n + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (s / 4)));
    if (steps > MAX_SHAPE_CELLS * 4) throw new TooManyCellsError();
    for (let t = 0; t <= steps; t++) add(p.x + ((q.x - p.x) * t) / steps, p.y + ((q.y - p.y) * t) / steps);
  }
  return out;
}

/** 多边形内部（格子中心在多边形内）的所有格子，加上边框经过的格子 */
export function rasterizeFill(pts: Pt[], s: number): CellIJ[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const i0 = Math.floor(minX / s), i1 = Math.floor(maxX / s);
  const j0 = Math.floor(minY / s), j1 = Math.floor(maxY / s);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_SHAPE_CELLS) throw new TooManyCellsError();
  const out = rasterizeStroke(pts, true, s);
  const seen = new Set(out.map((c) => c.i + "," + c.j));
  // 逐行扫描：求格子中心所在水平线与多边形各边的交点
  for (let j = j0; j <= j1; j++) {
    const y = (j + 0.5) * s;
    const xs: number[] = [];
    for (let n = 0; n < pts.length; n++) {
      const p = pts[n], q = pts[(n + 1) % pts.length];
      if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
    xs.sort((u, v) => u - v);
    for (let n = 0; n + 1 < xs.length; n += 2) {
      const ia = Math.ceil(xs[n] / s - 0.5), ib = Math.floor(xs[n + 1] / s - 0.5);
      for (let i = ia; i <= ib; i++) {
        const key = i + "," + j;
        if (!seen.has(key)) { seen.add(key); out.push({ i, j }); }
      }
    }
  }
  return out;
}
