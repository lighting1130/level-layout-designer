import type { Camera } from "./camera";
import { ORIENTED_ICONS } from "./engine";

/**
 * 关卡图标：楼梯、宝箱、陷阱、记录点……
 * 每个图标是一个彩色圆角方块 + 白色线条图案，图案按 24×24 的坐标画（SVG path 语法）。
 * 图标放在世界坐标 (x, y)（中心），size 是世界单位下的边长，跟格子一起缩放。
 */
export interface IconDef {
  label: string;
  color: string;
  path: string;
}

export const ICONS = {
  "stairs-up": { label: "上楼梯", color: "#4f7fd9", path: "M4 20h4v-4h4v-4h4V8h4M7 11V4M4.5 6.5 7 4l2.5 2.5" },
  "stairs-down": { label: "下楼梯", color: "#3b5fa8", path: "M4 20h4v-4h4v-4h4V8h4M7 4v7M4.5 8.5 7 11l2.5-2.5" },
  ladder: { label: "梯子", color: "#4f7fd9", path: "M8 3v18M16 3v18M8 7.5h8M8 12h8M8 16.5h8" },
  door: { label: "门", color: "#9a6a3a", path: "M6 21V4h12v17M3.5 21h17M14.5 12.5v.01" },
  locked: { label: "锁着的门", color: "#7a4f2a", path: "M7.5 11V8a4.5 4.5 0 0 1 9 0v3M5.5 11h13v9.5h-13zM12 14.5v2.5" },
  key: { label: "钥匙", color: "#c9971c", path: "M4 16.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M10 14l9-9M15.5 8.5l2.5 2.5M13 11l2 2" },
  chest: { label: "宝箱", color: "#c97a1c", path: "M4 10.5h16V20H4zM4 10.5V8a3.5 3.5 0 0 1 3.5-3.5h9A3.5 3.5 0 0 1 20 8v2.5M10 10.5v3.5h4v-3.5" },
  trap: { label: "陷阱", color: "#c8364f", path: "M3 20h18M4.5 20l2.5-8.5 2.5 8.5M9.5 20 12 6l2.5 14M14.5 20l2.5-8.5 2.5 8.5" },
  save: { label: "记录点", color: "#2fa39a", path: "M6.5 21V3.5M6.5 4.5h11l-2.5 4 2.5 4h-11" },
  spawn: { label: "出生点", color: "#4a9a48", path: "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0" },
  goal: { label: "终点/目标", color: "#8f5ec7", path: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.5a2.5 2.5 0 0 0 2.5 4M16 6h2.5a2.5 2.5 0 0 1-2.5 4M12 13v4M8 20.5h8M9.5 17h5" },
  boss: { label: "Boss", color: "#7a1f3d", path: "M5 11a7 7 0 1 1 14 0v3l-2 1.5V19H7v-3.5L5 14zM9.5 11.5v.01M14.5 11.5v.01M10.5 19v-2M13.5 19v-2" },
  enemy: { label: "敌人", color: "#c8364f", path: "M5 5l11 11M19 5 8 16M14 18l4-4M10 18l-4-4M17 17l2.5 2.5M7 17l-2.5 2.5" },
  npc: { label: "NPC/对话", color: "#3f7fc8", path: "M4 5h16v11h-9l-4 3.5V16H4zM8 9h8M8 12.5h5" },
  shop: { label: "商店", color: "#b8891a", path: "M4 9h16l-1.5 11h-13zM8.5 9V7a3.5 3.5 0 0 1 7 0v2M12 12.5v5M10 14h3.5" },
  heal: { label: "回复", color: "#d4507a", path: "M12 20s-7.5-4.5-7.5-10A4 4 0 0 1 12 7.5 4 4 0 0 1 19.5 10C19.5 15.5 12 20 12 20zM12 10.5v5M9.5 13h5" },
  item: { label: "道具", color: "#2fa39a", path: "M12 3.5 20 8v8l-8 4.5L4 16V8zM4 8l8 4.5L20 8M12 12.5v8" },
  switch: { label: "机关/开关", color: "#6b7383", path: "M4.5 19h15M8 19v-3h8v3M12 16 16 6.5M14.5 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0" },
  teleport: { label: "传送点", color: "#7a52c7", path: "M12 12h.01M12 12a2 2 0 1 1 2-2M14 10a4 4 0 1 1-4-4M10 6a6 6 0 1 1-6 6" },
  danger: { label: "危险", color: "#d97a1c", path: "M12 4 21 20H3zM12 10v4.5M12 17.5v.01" },
  camera: { label: "镜头/视点", color: "#556070", path: "M3.5 8.5h11v8h-11zM14.5 11l6-3v9l-6-3" },
} satisfies Record<string, IconDef>;

export type BuiltinIcon = keyof typeof ICONS;
export const isBuiltinIcon = (k: unknown): k is BuiltinIcon => typeof k === "string" && Object.prototype.hasOwnProperty.call(ICONS, k);

/** 用户导入的图标：kind 为 "u:" + 图片 id，图片数据和参考图存在一起 */
export interface CustomIcon { id: string; name: string }
export const CUSTOM_PREFIX = "u:";
export const customKind = (imageId: string) => CUSTOM_PREFIX + imageId;
export const customImageId = (kind: string) => (kind.startsWith(CUSTOM_PREFIX) ? kind.slice(CUSTOM_PREFIX.length) : null);

export function sanitizeCustomIcons(list: unknown, known?: (id: string) => boolean): CustomIcon[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: CustomIcon[] = [];
  for (const c of list as any[]) {
    if (!c || typeof c.id !== "string" || !c.id || seen.has(c.id) || (known && !known(c.id))) continue;
    seen.add(c.id);
    out.push({ id: c.id, name: typeof c.name === "string" && c.name.trim() ? c.name.trim().slice(0, 40) : "自定义图标" });
  }
  return out;
}

export interface MapIcon {
  /** 内置图标名，或 "u:<图片 id>" 表示自定义图标 */
  kind: string;
  /** 中心点（世界坐标） */
  x: number;
  y: number;
  /** 边长（世界单位） */
  size: number;
  /** 朝向（版本 5，可选）：顺时针角度，0 = 朝右（UE 的 +X）。框选旋转时按 90° 改变 */
  rot?: number;
}

export function sanitizeIcons(list: unknown, knownImage?: (id: string) => boolean): MapIcon[] {
  if (!Array.isArray(list)) return [];
  const ok = (k: unknown) => {
    if (isBuiltinIcon(k)) return true;
    if (typeof k !== "string") return false;
    const id = customImageId(k);
    return !!id && (!knownImage || knownImage(id));
  };
  return list
    .filter((n: any) => n && ok(n.kind) && [n.x, n.y, n.size].every((v) => typeof v === "number" && isFinite(v)) && n.size > 0)
    .map((n: any) => {
      const rot = typeof n.rot === "number" && isFinite(n.rot) ? normRot(n.rot) : 0;
      return { kind: n.kind, x: n.x, y: n.y, size: n.size, ...(rot ? { rot } : {}) };
    });
}

/** 角度规范到 [0, 360)，保留一位小数 */
export function normRot(deg: number) {
  const r = Math.round((((deg % 360) + 360) % 360) * 10) / 10;
  return r >= 360 ? 0 : r;
}

const paths = new Map<string, Path2D>();
function glyph(kind: BuiltinIcon): Path2D {
  let p = paths.get(kind);
  if (!p) { p = new Path2D(ICONS[kind].path); paths.set(kind, p); }
  return p;
}

/** 取自定义图标图片的函数（图片未加载好时返回 null） */
export type ImageGetter = (id: string) => HTMLImageElement | null;

/** 在屏幕 (cx, cy) 处画一个边长 px 像素的图标（工具面板和画布共用） */
export function drawIconAt(ctx: CanvasRenderingContext2D, kind: string, cx: number, cy: number, px: number, highlight = false, getImage?: ImageGetter) {
  const imgId = customImageId(kind);
  if (imgId !== null) {
    // 自定义图标：图片按比例放进方块里，保留透明背景
    const img = getImage?.(imgId);
    if (img) {
      const sc = px / Math.max(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    } else {
      ctx.fillStyle = "#3a3f4b";
      ctx.fillRect(cx - px / 2, cy - px / 2, px, px);
    }
    if (highlight) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#7aa2f7";
      ctx.strokeRect(cx - px / 2, cy - px / 2, px, px);
    }
    return;
  }
  if (!isBuiltinIcon(kind)) return;
  const def = ICONS[kind];
  if (px < 5) {
    ctx.fillStyle = def.color;
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
    return;
  }
  const r = px * 0.2;
  ctx.beginPath();
  ctx.roundRect(cx - px / 2, cy - px / 2, px, px, r);
  ctx.fillStyle = def.color;
  ctx.fill();
  ctx.lineWidth = highlight ? 2 : 1;
  ctx.strokeStyle = highlight ? "#7aa2f7" : "rgba(0,0,0,0.45)";
  ctx.stroke();
  if (px < 10) return;
  ctx.save();
  // 图案画在方块内 80% 的区域
  const k = (px * 0.8) / 24;
  ctx.translate(cx - 12 * k, cy - 12 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(glyph(kind));
  ctx.restore();
}

export function drawIcons(ctx: CanvasRenderingContext2D, cam: Camera, list: MapIcon[], getImage: ImageGetter, alpha = 1, highlight?: Set<MapIcon>) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const ic of list) {
    const p = cam.worldToScreen(ic.x, ic.y);
    const px = ic.size * cam.zoom;
    if (p.x + px < 0 || p.y + px < 0 || p.x - px > ctx.canvas.width || p.y - px > ctx.canvas.height) continue;
    drawIconAt(ctx, ic.kind, p.x, p.y, px, highlight?.has(ic), getImage);
    if (px >= 10 && (ic.rot || ORIENTED_ICONS.has(ic.kind))) drawFacing(ctx, p.x, p.y, px, ic.rot ?? 0);
  }
  ctx.restore();
}

/** 在图标外侧画一个小三角，表示朝向（rot 顺时针角度，0 = 朝右） */
function drawFacing(ctx: CanvasRenderingContext2D, cx: number, cy: number, px: number, rot: number) {
  const a = (rot * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const r0 = px * 0.56, r1 = px * 0.56 + Math.max(4, px * 0.22), w = Math.max(3, px * 0.14);
  ctx.beginPath();
  ctx.moveTo(cx + ux * r1, cy + uy * r1);
  ctx.lineTo(cx + ux * r0 - uy * w, cy + uy * r0 + ux * w);
  ctx.lineTo(cx + ux * r0 + uy * w, cy + uy * r0 - ux * w);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.stroke();
}

/** 世界坐标点是否落在图标上 */
export function hitIcon(ic: MapIcon, x: number, y: number, tol = 0) {
  const h = ic.size / 2 + tol;
  return Math.abs(x - ic.x) <= h && Math.abs(y - ic.y) <= h;
}
