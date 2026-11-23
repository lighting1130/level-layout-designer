import { levelStep } from "./grid";
import { refImageBounds, type RefImage } from "./refimages";

/**
 * 从参考图生成格子：把（可能旋转过的）参考图按格子大小重新采样，
 * 每个格子取平均颜色，再换成颜色说明里的颜色。全部在浏览器里完成。
 */
export interface TraceOptions {
  /** color：每格换成最接近的颜色说明颜色；line：深色的地方涂成一种颜色（适合线稿、黑白平面图） */
  mode: "color" | "line";
  /** 格子层级（和画笔一样，0 是基础格子） */
  k: number;
  /** 颜色匹配的容差 0–1：颜色差得比这更远的格子不涂 */
  tolerance: number;
  /** 线稿模式的深浅阈值 0–1：比它暗的格子才涂 */
  threshold: number;
  lineColor: string;
  /** 颜色匹配时可以用的颜色 */
  colors: string[];
  /** 跳过接近白色的背景 */
  ignoreBg: boolean;
  /** 颜色匹配时，黑色/深灰色的线条直接算成这种颜色（通常是墙）；null 表示不特殊处理 */
  darkColor: string | null;
  /** 去掉周围没有同色格子的孤立小点 */
  denoise: boolean;
}

export interface TraceCell { i: number; j: number; color: string }
export interface TraceResult { cells: TraceCell[]; tooMany: boolean; area: number }

/** 采样范围最多这么多个格子，超过就请用户换大一点的格子 */
export const MAX_TRACE_AREA = 400_000;

const rgb = (hex: string) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));

/** 近似人眼感受的 RGB 距离（redmean），0–约 765 */
function colorDist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
const MAX_DIST = colorDist(0, 0, 0, 255, 255, 255);

/** 参考图覆盖到的格子范围 */
export function traceArea(r: RefImage, k: number) {
  const s = levelStep(k);
  const b = refImageBounds(r);
  const i0 = Math.floor(b.x0 / s), j0 = Math.floor(b.y0 / s);
  const cols = Math.max(1, Math.ceil(b.x1 / s) - i0), rows = Math.max(1, Math.ceil(b.y1 / s) - j0);
  return { s, i0, j0, cols, rows, area: cols * rows };
}

export function traceImage(img: CanvasImageSource, r: RefImage, o: TraceOptions): TraceResult {
  const { s, i0, j0, cols, rows, area } = traceArea(r, o.k);
  if (area > MAX_TRACE_AREA) return { cells: [], tooMany: true, area };
  // 每个格子采 f×f 个像素再取平均
  const f = Math.max(1, Math.min(o.mode === "line" ? 12 : 6, Math.floor(Math.sqrt((o.mode === "line" ? 4e6 : 2e6) / area))));
  const c = document.createElement("canvas");
  c.width = cols * f;
  c.height = rows * f;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const z = f / s;
  ctx.setTransform(z, 0, 0, z, -i0 * s * z, -j0 * s * z);
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  if (r.rot) ctx.rotate((r.rot * Math.PI) / 180);
  ctx.drawImage(img, -r.w / 2, -r.h / 2, r.w, r.h);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;

  const palette = o.colors.map((hex) => ({ hex, v: rgb(hex) }));
  const grid = new Map<number, string>();
  const W = c.width;
  const need = Math.max(1, Math.ceil(0.3 * f * f));
  const counts = new Map<string, number>();
  /** 颜色匹配：单个像素归到哪种颜色（null 表示背景或不像任何颜色） */
  const classify = (R: number, G: number, B: number): string | null => {
    const lum = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
    const sat = (Math.max(R, G, B) - Math.min(R, G, B)) / 255;
    if (o.ignoreBg && lum > 0.88 && sat < 0.12) return null;
    if (o.darkColor && lum < 0.35 && sat < 0.15) return o.darkColor;
    let best = Infinity, hex: string | null = null;
    for (const p of palette) {
      const d = colorDist(R, G, B, p.v[0], p.v[1], p.v[2]);
      if (d < best) { best = d; hex = p.hex; }
    }
    return best / MAX_DIST <= o.tolerance ? hex : null;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let color: string | null = null;
      if (o.mode === "line") {
        // 线稿看格子里最暗的一点，细线也不会被白底平均掉
        let minLum = 1;
        for (let y = row * f; y < row * f + f; y++) {
          for (let x = col * f; x < col * f + f; x++) {
            const p = (y * W + x) * 4;
            if (data[p + 3] > 128) minLum = Math.min(minLum, (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255);
          }
        }
        if (minLum < o.threshold) color = o.lineColor;
      } else {
        // 颜色匹配：格子里每个采样点先各自归类，再取占比最多的一种（至少占 30%），
        // 这样墙边和白底混在一起时不会平均出一种不相干的颜色
        counts.clear();
        for (let y = row * f; y < row * f + f; y++) {
          for (let x = col * f; x < col * f + f; x++) {
            const p = (y * W + x) * 4;
            if (data[p + 3] < 128) continue;
            const h = classify(data[p], data[p + 1], data[p + 2]);
            if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
          }
        }
        let most = 0;
        for (const [h, n] of counts) if (n > most) { most = n; color = h; }
        if (most < need) color = null;
      }
      if (color) grid.set(row * cols + col, color);
    }
  }
  const cells: TraceCell[] = [];
  for (const [key, color] of grid) {
    const row = Math.floor(key / cols), col = key % cols;
    if (o.denoise) {
      let same = 0;
      for (let dy = -1; dy <= 1 && !same; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const rr = row + dy, cc = col + dx;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (grid.get(rr * cols + cc) === color) { same++; break; }
        }
      }
      if (!same) continue;
    }
    cells.push({ i: i0 + col, j: j0 + row, color });
  }
  return { cells, tooMany: false, area };
}
