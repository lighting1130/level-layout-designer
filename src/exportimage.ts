import { Camera } from "./camera";
import { t } from "./i18n";
import type { CellLayer } from "./cells";
import { CELL_SIZE, drawGrid, levelStep } from "./grid";
import { customImageId, drawIconAt, drawIcons, type MapIcon } from "./icons";
import { drawNotes, type Note } from "./notes";
import { formatLength, getMetersPerCell } from "./units";
import { drawRefImages, refImageBounds, type ImageStore, type RefImage } from "./refimages";
import { drawVectors, vectorBounds, type VectorShape } from "./vectors";

/**
 * 导出图片：每层画成一张 PNG，图片底部横排颜色说明（和用到的图标）。
 * 支持：当前层 / 全部楼层（打包 ZIP）/ 全部楼层拼成一张长图。
 */
export interface ExportOptions {
  floors: "current" | "each" | "stack";
  /** 自动裁剪到内容，或用当前屏幕范围 */
  area: "content" | "view";
  /** 每个基础格子多少像素 */
  cellPx: number;
  theme: "dark" | "light";
  grid: boolean;
  refImages: boolean;
  notes: boolean;
  /** 颜色说明只列出这一层用到的颜色 */
  usedOnly: boolean;
  /** 所有楼层用同一个范围，导出的图可以直接叠在一起对照 */
  sameArea: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = {
  floors: "each", area: "content", cellPx: 32, theme: "light",
  grid: true, refImages: false, notes: true, usedOnly: true, sameArea: true,
};

export interface ExportFloor {
  level: number;
  name: string;
  layer: CellLayer;
  vectors: VectorShape[];
  notes: Note[];
  images: RefImage[];
  icons: MapIcon[];
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

const MAX_SIDE = 8000;
const MAX_AREA = 40e6;
const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const THEMES = {
  dark: { bg: "#1e2127", panel: "#262a32", text: "#e6e8ec", sub: "#9aa1ad", line: "255,255,255", border: "#3a3f4b" },
  light: { bg: "#ffffff", panel: "#f4f5f7", text: "#1f2328", sub: "#5c6370", line: "0,0,0", border: "#d0d4da" },
};

/** 一层内容在世界坐标里的范围（不含备注便签，便签按像素另算）；空层返回 null */
export function floorBounds(f: ExportFloor, opts: ExportOptions): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (a: number, b: number, c: number, d: number) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d); };
  for (const c of f.layer.toJSON()) { const s = levelStep(c.k); add(c.i * s, c.j * s, (c.i + 1) * s, (c.j + 1) * s); }
  for (const v of f.vectors) { const b = vectorBounds(v); add(b.x0, b.y0, b.x1, b.y1); }
  for (const ic of f.icons) add(ic.x - ic.size / 2, ic.y - ic.size / 2, ic.x + ic.size / 2, ic.y + ic.size / 2);
  if (opts.notes) for (const n of f.notes) add(n.x, n.y, n.x, n.y);
  if (opts.refImages) for (const r of f.images) { const b = refImageBounds(r); add(b.x0, b.y0, b.x1, b.y1); }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** 每条备注的便签相对钉子的像素范围（借用 drawNotes 量出来，和实际画出来的一致） */
function noteLabelRects(notes: Note[]) {
  const ctx = document.createElement("canvas").getContext("2d")!;
  return notes.map((n) => {
    const cam = new Camera();
    cam.x = n.x;
    cam.y = n.y;
    const box = drawNotes(ctx, cam, [n]).find((b) => !b.pin)!;
    return { n, x0: Math.min(0, box.x0), y0: Math.min(0, box.y0), x1: Math.max(0, box.x1), y1: Math.max(0, box.y1) };
  });
}

export const unionBox = (a: Box | null, b: Box | null): Box | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

interface LegendItem { color?: string; icon?: string; label: string }

/** 底部说明：颜色（可只列用到的）+ 这一层用到的图标 */
function legendItems(floors: ExportFloor[], legend: { name: string; color: string }[], iconLabel: (kind: string) => string, opts: ExportOptions): LegendItem[] {
  const used = new Set<string>();
  for (const f of floors) {
    for (const c of f.layer.toJSON()) used.add(c.color);
    for (const v of f.vectors) used.add(v.color);
  }
  const items: LegendItem[] = [];
  const named = new Set<string>();
  for (const e of legend) {
    named.add(e.color);
    if (!opts.usedOnly || used.has(e.color)) items.push({ color: e.color, label: e.name });
  }
  // 用了但不在颜色说明里的颜色也列出来，免得看图的人对不上
  for (const c of used) if (!named.has(c)) items.push({ color: c, label: c.toUpperCase() });
  const kinds: string[] = [];
  for (const f of floors) for (const ic of f.icons) if (!kinds.includes(ic.kind)) kinds.push(ic.kind);
  for (const k of kinds) items.push({ icon: k, label: iconLabel(k) });
  return items;
}

/** 量出说明条每一项的位置（自动换行），返回总高度 */
function layoutLegend(ctx: CanvasRenderingContext2D, items: LegendItem[], width: number) {
  const PAD = 16, ROW = 28, GAP = 22, SW = 16;
  ctx.font = `14px ${FONT}`;
  let x = PAD, y = PAD + 22;
  const pos: { item: LegendItem; x: number; y: number }[] = [];
  for (const item of items) {
    const w = SW + 8 + ctx.measureText(item.label).width;
    if (x > PAD && x + w > width - PAD) { x = PAD; y += ROW; }
    pos.push({ item, x, y });
    x += w + GAP;
  }
  return { pos, height: items.length ? y + ROW - 6 + PAD / 2 : 0 };
}

function drawLegend(ctx: CanvasRenderingContext2D, items: LegendItem[], top: number, width: number, theme: typeof THEMES.dark, getImage: (id: string) => HTMLImageElement | null) {
  const { pos, height } = layoutLegend(ctx, items, width);
  if (!height) return;
  ctx.fillStyle = theme.panel;
  ctx.fillRect(0, top, width, height);
  ctx.fillStyle = theme.border;
  ctx.fillRect(0, top, width, 1);
  ctx.fillStyle = theme.sub;
  ctx.font = `bold 13px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText(t("颜色说明"), 16, top + 18);
  ctx.font = `14px ${FONT}`;
  for (const { item, x, y } of pos) {
    const cy = top + y + 8;
    if (item.color) {
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.roundRect(x, cy - 8, 16, 16, 3);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (item.icon) {
      drawIconAt(ctx, item.icon, x + 8, cy, 18, false, getImage);
    }
    ctx.fillStyle = theme.text;
    ctx.fillText(item.label, x + 24, cy + 1);
  }
}

const HEADER = 44;

export interface RenderInput {
  floors: ExportFloor[];
  legend: { name: string; color: string }[];
  /** 图标在说明里显示的文字（用户可以改） */
  iconLabel: (kind: string) => string;
  store: ImageStore;
  title: string;
  /** 当前屏幕范围（area = "view" 时用） */
  view: Box;
}

export interface RenderedImage { name: string; canvas: HTMLCanvasElement }

/**
 * 按选项画出图片。返回每张图（stack 模式只有一张），以及是否因为太大而降低了清晰度。
 */
export async function renderExport(input: RenderInput, opts: ExportOptions): Promise<{ images: RenderedImage[]; downscaled: boolean }> {
  const theme = THEMES[opts.theme];
  const getImage = (id: string) => input.store.get(id);
  // 先等用到的图片解码好
  const ids = new Set<string>();
  for (const f of input.floors) {
    if (opts.refImages) f.images.forEach((r) => ids.add(r.id));
    f.icons.forEach((ic) => { const id = customImageId(ic.kind); if (id) ids.add(id); });
  }
  await Promise.all([...ids].map((id) => input.store.ready(id)));

  // 每层的范围
  const margin = CELL_SIZE;
  const boxes = input.floors.map((f) => (opts.area === "view" ? input.view : floorBounds(f, opts)));
  let shared: Box | null = null;
  if (opts.area === "view") shared = input.view;
  else if (opts.sameArea || opts.floors === "stack") for (const b of boxes) shared = unionBox(shared, b);
  const fallback: Box = { x0: -5 * CELL_SIZE, y0: -5 * CELL_SIZE, x1: 5 * CELL_SIZE, y1: 5 * CELL_SIZE };

  let zoom = opts.cellPx / CELL_SIZE;
  // 备注便签的大小是固定像素，要按当前比例换算成世界范围再并进去
  const labels = input.floors.map((f) => (opts.notes && opts.area === "content" ? noteLabelRects(f.notes) : []));
  const withLabels = (b: Box | null, ls: ReturnType<typeof noteLabelRects>, z: number): Box | null => {
    let out = b;
    for (const l of ls) out = unionBox(out, { x0: l.n.x + l.x0 / z, y0: l.n.y + l.y0 / z, x1: l.n.x + l.x1 / z, y1: l.n.y + l.y1 / z });
    return out;
  };
  const frame = (n: number, z = zoom) => {
    let b0: Box | null;
    if (opts.area === "view") b0 = shared;
    else if (shared) { b0 = shared; labels.forEach((ls) => { b0 = withLabels(b0, ls, z); }); }
    else b0 = withLabels(boxes[n], labels[n], z);
    b0 = b0 ?? fallback;
    const m = opts.area === "view" ? 0 : margin;
    return { b: { x0: b0.x0 - m, y0: b0.y0 - m, x1: b0.x1 + m, y1: b0.y1 + m }, p: { l: 0, t: 0, r: 0, b: 0 } };
  };
  // 太大时自动降低清晰度
  let downscaled = false;
  const sizeAt = (n: number, z: number) => {
    const { b } = frame(n, z);
    return { w: (b.x1 - b.x0) * z, h: (b.y1 - b.y0) * z };
  };
  const fits = (z: number) => {
    if (opts.floors === "stack") {
      let w = 0, h = 0;
      input.floors.forEach((_, n) => { const s = sizeAt(n, z); w = Math.max(w, s.w); h += s.h + HEADER; });
      return w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_AREA;
    }
    return input.floors.every((_, n) => { const s = sizeAt(n, z); return s.w <= MAX_SIDE && s.h + HEADER <= MAX_SIDE && s.w * s.h <= MAX_AREA; });
  };
  while (!fits(zoom) && zoom > 1e-9) { zoom /= 1.25; downscaled = true; }

  const measure = document.createElement("canvas").getContext("2d")!;

  /** 在 ctx 的 (0, top) 处画一层地图，返回高度 */
  const drawFloor = (ctx: CanvasRenderingContext2D, n: number, top: number, width: number, withHeader: boolean) => {
    const f = input.floors[n];
    const { b, p } = frame(n);
    const mapW = Math.ceil((b.x1 - b.x0) * zoom + p.l + p.r);
    const mapH = Math.ceil((b.y1 - b.y0) * zoom + p.t + p.b);
    let y = top;
    if (withHeader) {
      ctx.fillStyle = theme.panel;
      ctx.fillRect(0, y, width, HEADER);
      ctx.fillStyle = theme.text;
      ctx.font = `bold 18px ${FONT}`;
      ctx.textBaseline = "middle";
      ctx.fillText(`${input.title} · ${f.name}`, 16, y + HEADER / 2);
      ctx.fillStyle = theme.sub;
      ctx.font = `13px ${FONT}`;
      const scale = t("1 格 = {len}（{px} 像素）", { len: formatLength(getMetersPerCell(), getMetersPerCell()), px: Number((CELL_SIZE * zoom).toFixed(2)) });
      ctx.fillText(scale, width - 16 - ctx.measureText(scale).width, y + HEADER / 2);
      y += HEADER;
    }
    const offX = Math.floor((width - mapW) / 2);
    ctx.save();
    ctx.translate(offX, y);
    ctx.beginPath();
    ctx.rect(0, 0, mapW, mapH);
    ctx.clip();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, mapW, mapH);
    const cam = new Camera();
    cam.zoom = zoom;
    cam.x = b.x0 - p.l / zoom;
    cam.y = b.y0 - p.t / zoom;
    if (opts.refImages) drawRefImages(ctx, cam, f.images, input.store);
    f.layer.draw(ctx, cam, mapW, mapH);
    if (opts.grid) drawGrid(ctx, cam, mapW, mapH, { lineRGB: theme.line, axes: false });
    drawVectors(ctx, cam, f.vectors);
    drawIcons(ctx, cam, f.icons, getImage);
    if (opts.notes) drawNotes(ctx, cam, f.notes);
    ctx.restore();
    return y - top + mapH;
  };

  const make = (w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  };
  const MIN_W = 560;
  const images: RenderedImage[] = [];

  if (opts.floors === "stack") {
    let width = MIN_W, height = 0;
    input.floors.forEach((_, n) => { const s = sizeAt(n, zoom); width = Math.max(width, Math.ceil(s.w)); height += Math.ceil(s.h) + HEADER; });
    const items = legendItems(input.floors, input.legend, input.iconLabel, opts);
    const legendH = layoutLegend(measure, items, width).height;
    const canvas = make(width, height + legendH);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    input.floors.forEach((_, n) => { y += drawFloor(ctx, n, y, width, true); });
    drawLegend(ctx, items, y, width, theme, getImage);
    images.push({ name: t("全部楼层"), canvas });
  } else {
    input.floors.forEach((f, n) => {
      const s = sizeAt(n, zoom);
      const width = Math.max(MIN_W, Math.ceil(s.w));
      const items = legendItems([f], input.legend, input.iconLabel, opts);
      const legendH = layoutLegend(measure, items, width).height;
      const canvas = make(width, HEADER + Math.ceil(s.h) + legendH);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const h = drawFloor(ctx, n, 0, width, true);
      drawLegend(ctx, items, h, width, theme, getImage);
      images.push({ name: f.name, canvas });
    });
  }
  return { images, downscaled };
}

export const canvasToPng = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));

// ---------------- 最简单的 ZIP（只存储、不压缩；PNG 本身已压缩） ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name) as Uint8Array<ArrayBuffer>;
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // 文件名是 UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const entry = new Uint8Array(46 + name.length);
    entry.set(new Uint8Array(cd.buffer), 0);
    entry.set(name, 46);
    central.push(entry);
    offset += 30 + name.length + f.data.length;
  }
  const cdSize = central.reduce((s, e) => s + e.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}
