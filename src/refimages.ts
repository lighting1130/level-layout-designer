import type { Camera } from "./camera";

/**
 * 参考图：铺在格子下面的一张图片，用来对照着描画关卡。
 * 位置和大小用世界坐标（和格子同一套单位），图片数据单独存放（见 ImageStore），
 * 这样撤销记录和楼层数据里只保存小小的位置信息。
 */
export interface RefImage {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 不透明度 0.05–1 */
  opacity: number;
  /** 锁定后点击和拖动会穿透它，方便在上面画画 */
  locked: boolean;
  /** 绕图片中心顺时针旋转的角度（度），0 时省略 */
  rot?: number;
}

export const DEFAULT_OPACITY = 0.5;
const MAX_SIDE = 2048;

/** 角度规范到 (-180, 180]，并去掉浮点误差 */
export const normAngle = (deg: number) => {
  let a = Math.round(((deg % 360) + 360) % 360 * 100) / 100;
  if (a > 180) a -= 360;
  return a === 0 ? 0 : a;
};

export const clampOpacity = (v: number) => Math.max(0.05, Math.min(1, v));

export function sanitizeRefImages(list: unknown, known?: (id: string) => boolean): RefImage[] {
  if (!Array.isArray(list)) return [];
  const out: RefImage[] = [];
  for (const r of list as any[]) {
    if (!r || typeof r.id !== "string" || !r.id) continue;
    if (![r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && isFinite(n))) continue;
    if (r.w <= 0 || r.h <= 0) continue;
    if (known && !known(r.id)) continue;
    out.push({
      id: r.id,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      opacity: typeof r.opacity === "number" && isFinite(r.opacity) ? clampOpacity(r.opacity) : DEFAULT_OPACITY,
      locked: r.locked === true,
      ...(typeof r.rot === "number" && isFinite(r.rot) && normAngle(r.rot) ? { rot: normAngle(r.rot) } : {}),
    });
  }
  return out;
}

/** 只接受常见位图的 data URL，防止导入的工程文件里夹带别的东西 */
export const isImageDataUrl = (s: unknown): s is string =>
  typeof s === "string" && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);

/** 图片数据：id -> data URL，以及解码好的 <img> 缓存 */
export class ImageStore {
  readonly srcs = new Map<string, string>();
  private imgs = new Map<string, HTMLImageElement>();
  constructor(private onLoad: () => void) {}

  add(src: string): string {
    // 同一张图只存一份
    for (const [id, s] of this.srcs) if (s === src) return id;
    const id = `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    this.srcs.set(id, src);
    return id;
  }
  set(id: string, src: string) {
    this.srcs.set(id, src);
    this.imgs.delete(id);
  }
  has(id: string) {
    return this.srcs.has(id);
  }
  /** 只保留仍被使用的图片 */
  prune(used: Set<string>) {
    for (const id of [...this.srcs.keys()]) if (!used.has(id)) { this.srcs.delete(id); this.imgs.delete(id); }
  }
  /** 等图片解码完成（导出图片前用） */
  async ready(id: string): Promise<void> {
    this.get(id);
    const img = this.imgs.get(id);
    if (img && !(img.complete && img.naturalWidth)) await img.decode().catch(() => undefined);
  }
  get(id: string): HTMLImageElement | null {
    let img = this.imgs.get(id);
    if (!img) {
      const src = this.srcs.get(id);
      if (!src) return null;
      img = new Image();
      img.onload = this.onLoad;
      img.src = src;
      this.imgs.set(id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
}

/** 画参考图（按数组顺序，后面的在上面） */
export function drawRefImages(ctx: CanvasRenderingContext2D, cam: Camera, list: RefImage[], store: ImageStore, alpha = 1) {
  for (const r of list) {
    const img = store.get(r.id);
    const c = cam.worldToScreen(r.x + r.w / 2, r.y + r.h / 2);
    const w = r.w * cam.zoom, h = r.h * cam.zoom;
    ctx.save();
    ctx.translate(c.x, c.y);
    if (r.rot) ctx.rotate((r.rot * Math.PI) / 180);
    ctx.globalAlpha = alpha * r.opacity;
    if (img) {
      ctx.imageSmoothingEnabled = w < img.naturalWidth * 2;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = "#3a3f4b";
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
}

/** 世界坐标下参考图的四个角（左上、右上、右下、左下，已旋转） */
export function refImageCorners(r: RefImage): { x: number; y: number }[] {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const t = ((r.rot ?? 0) * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx * r.w) / 2, dy = (sy * r.h) / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

/** 旋转后的外接框（世界坐标） */
export function refImageBounds(r: RefImage) {
  const c = refImageCorners(r);
  const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** 世界坐标点转到图片自身的坐标（原点在图片中心，未旋转方向） */
export function refImageLocal(r: RefImage, x: number, y: number) {
  const t = (-(r.rot ?? 0) * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const dx = x - (r.x + r.w / 2), dy = y - (r.y + r.h / 2);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/**
 * 读入用户选的图片文件：太大的缩到最长边 2048 像素，再编码成 data URL。
 * 返回 data URL 和像素尺寸。
 */
export async function loadImageFile(file: Blob, maxSide = MAX_SIDE): Promise<{ src: string; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // 没写尺寸的 SVG 可能读不到大小，按正方形处理
    const nw = img.naturalWidth || maxSide, nh = img.naturalHeight || maxSide;
    const scale = Math.min(file.type === "image/svg+xml" ? maxSide / Math.max(nw, nh) : 1, maxSide / Math.max(nw, nh));
    const width = Math.max(1, Math.round(nw * scale));
    const height = Math.max(1, Math.round(nh * scale));
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.drawImage(img, 0, 0, width, height);
    // 优先用 webp（体积小且保留透明）；不支持时 png 保留透明，其他用 jpeg
    let src = c.toDataURL("image/webp", 0.9);
    if (!src.startsWith("data:image/webp")) src = file.type === "image/jpeg" ? c.toDataURL("image/jpeg", 0.9) : c.toDataURL("image/png");
    return { src, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
