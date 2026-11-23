import type { Cell } from "./cells";
import { getLang, t } from "./i18n";
import { sanitizeVectors, type VectorShape } from "./vectors";
import { sanitizeNotes, type Note } from "./notes";
import { sanitizeCustomIcons, sanitizeIcons, type CustomIcon, type MapIcon } from "./icons";
import { isImageDataUrl, sanitizeRefImages, type RefImage } from "./refimages";
import { guessRole, isEngineRole, parseMeters, type EngineRole } from "./engine";

/** 工程文件格式（.json）。字段说明见 docs/project-file-format.md */
export const PROJECT_FORMAT = "level-layout-designer";
/**
 * 版本 3：内容按楼层保存在 floors 中。
 * 版本 4：新增参考图（顶层 images 存图片数据，floors[].images 存位置）、
 *         关卡图标（floors[].icons）和自定义图标库（customIcons）。
 * 版本 5：给游戏引擎导入用的信息——legend 加 id / role / height，楼层加 elevation / wallHeight，
 *         图标加 rot（朝向）。都是可选字段，旧版本文件照常导入。
 * 版本 1/2 的文件（顶层 cells / vectors）导入时视为“第一层”。
 */
export const PROJECT_VERSION = 5;

/** 颜色说明的一项 */
export interface LegendData {
  /** 稳定的 id（版本 5），改名改色都不变 */
  id?: string;
  name: string;
  color: string;
  /** 在游戏引擎里生成成什么（版本 5）；旧文件按名字猜 */
  role?: EngineRole;
  /** 这种颜色的墙/块的高度（米，版本 5，可选），不写用楼层墙高 */
  height?: number;
}

export interface FloorData {
  /** 楼层号：1 = 第一层，2 = 第二层，-1 = 负一层……没有 0 */
  level: number;
  cells: Cell[];
  vectors: VectorShape[];
  /** 备注（可选，旧文件没有） */
  notes: Note[];
  /** 参考图的位置和设置（可选，旧文件没有） */
  images: RefImage[];
  /** 关卡图标（可选，旧文件没有） */
  icons: MapIcon[];
  /** 这一层地面的标高（米，版本 5，可选），不写按默认层高推算 */
  elevation?: number;
  /** 这一层的墙高（米，版本 5，可选） */
  wallHeight?: number;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  grid: { cellSize: number; subdivision: number };
  view: { x: number; y: number; zoom: number };
  legend: LegendData[];
  currentFloor: number;
  floors: FloorData[];
  /** 参考图数据：id -> data URL */
  images: Record<string, string>;
  /** 用户导入的图标库 */
  customIcons: CustomIcon[];
  /** 图标说明：图标 -> 用户写的含义（没写的用图标默认名字） */
  iconLabels: Record<string, string>;
  /** 一个基础格子代表的现实长度（米），可选，默认 1 */
  metersPerCell?: number;
}

export function sanitizeIconLabels(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) if (typeof v === "string" && v.trim() && k.length <= 80) out[k] = v.trim().slice(0, 60);
  }
  return out;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function sanitizeCells(list: unknown): Cell[] {
  return Array.isArray(list)
    ? list.filter(
        (c: any) => c && Number.isInteger(c.k) && Number.isInteger(c.i) && Number.isInteger(c.j) && typeof c.color === "string" && HEX.test(c.color),
      ).map((c: any) => ({ k: c.k, i: c.i, j: c.j, color: c.color.toLowerCase() }))
    : [];
}

/** 校验楼层列表：楼层号为非 0 整数且不重复，至少保留一层 */
export function sanitizeFloors(list: unknown, knownImage?: (id: string) => boolean): FloorData[] {
  const out: FloorData[] = [];
  const seen = new Set<number>();
  if (Array.isArray(list)) {
    for (const f of list as any[]) {
      if (!f || !Number.isInteger(f.level) || f.level === 0 || seen.has(f.level)) continue;
      seen.add(f.level);
      const elevation = parseMeters(f.elevation, true), wallHeight = parseMeters(f.wallHeight, false);
      out.push({
        level: f.level, cells: sanitizeCells(f.cells), vectors: sanitizeVectors(f.vectors), notes: sanitizeNotes(f.notes),
        images: sanitizeRefImages(f.images, knownImage), icons: sanitizeIcons(f.icons, knownImage),
        ...(elevation !== undefined ? { elevation } : {}), ...(wallHeight !== undefined ? { wallHeight } : {}),
      });
    }
  }
  if (!out.length) out.push({ level: 1, cells: [], vectors: [], notes: [], images: [], icons: [] });
  return out.sort((a, b) => b.level - a.level);
}

/** 校验并规范化一个导入的工程文件；格式不对时抛出带中文说明的错误 */
export function parseProject(text: string): ProjectFile {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("文件不是有效的 JSON。"));
  }
  if (!data || data.format !== PROJECT_FORMAT) throw new Error(t("这不是关卡 Layout 设计器的工程文件。"));
  if (typeof data.version !== "number" || data.version > PROJECT_VERSION) {
    throw new Error(t("工程文件版本比当前工具新，请使用新版工具打开。"));
  }
  const legend = sanitizeLegend(data.legend);
  const v = data.view;
  const view = v && [v.x, v.y, v.zoom].every((n) => typeof n === "number" && isFinite(n)) && v.zoom > 0
    ? { x: v.x, y: v.y, zoom: v.zoom }
    : { x: 0, y: 0, zoom: 1 };
  const images: Record<string, string> = {};
  if (data.images && typeof data.images === "object") {
    for (const [id, src] of Object.entries(data.images)) if (isImageDataUrl(src)) images[id] = src;
  }
  const known = (id: string) => Object.prototype.hasOwnProperty.call(images, id);
  const floors = Array.isArray(data.floors)
    ? sanitizeFloors(data.floors, known)
    : sanitizeFloors([{ level: 1, cells: data.cells, vectors: data.vectors, notes: [] }]);
  const currentFloor = floors.some((f) => f.level === data.currentFloor) ? data.currentFloor : floors.find((f) => f.level === 1)?.level ?? floors[0].level;
  return {
    format: PROJECT_FORMAT,
    version: data.version,
    name: typeof data.name === "string" ? data.name : "",
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    grid: { cellSize: 32, subdivision: 10 },
    view,
    legend,
    currentFloor,
    floors,
    images,
    customIcons: sanitizeCustomIcons(data.customIcons, known),
    iconLabels: sanitizeIconLabels(data.iconLabels),
    ...(typeof data.metersPerCell === "number" && isFinite(data.metersPerCell) && data.metersPerCell > 0 ? { metersPerCell: data.metersPerCell } : {}),
  };
}

/** 校验颜色说明；没有 role 的按名字猜，没有 id 的留空（由界面补上） */
export function sanitizeLegend(list: unknown): LegendData[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list.filter((e: any) => e && typeof e.name === "string" && typeof e.color === "string" && HEX.test(e.color)).map((e: any) => {
    const id = typeof e.id === "string" && e.id && e.id.length <= 64 && !seen.has(e.id) ? e.id : undefined;
    if (id) seen.add(id);
    const height = parseMeters(e.height, false);
    return {
      ...(id ? { id } : {}),
      name: e.name,
      color: e.color.toLowerCase(),
      role: isEngineRole(e.role) ? e.role : guessRole(e.name),
      ...(height !== undefined ? { height } : {}),
    };
  });
}

/** 楼层显示名：1 → 第一层，-1 → 负一层 */
export function floorName(level: number): string {
  // 英文：1F、2F……地下层 B1、B2
  if (getLang() === "en") return level < 0 ? `B${-level}` : `${level}F`;
  const n = Math.abs(level);
  return (level < 0 ? "负" : "第") + chineseNumber(n) + "层";
}

function chineseNumber(n: number): string {
  const d = "零一二三四五六七八九";
  if (n < 10) return d[n];
  if (n < 20) return "十" + (n % 10 ? d[n % 10] : "");
  if (n < 100) return d[Math.floor(n / 10)] + "十" + (n % 10 ? d[n % 10] : "");
  return String(n);
}

/** 把工程名变成安全的文件名 */
export function projectFileName(name: string): string {
  const base = (name.trim() || t("未命名关卡")).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 80);
  return `${base}.json`;
}
