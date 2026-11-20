import type { Cell } from "./cells";
import { sanitizeVectors, type VectorShape } from "./vectors";
import { sanitizeNotes, type Note } from "./notes";

/** 工程文件格式（.json）。字段说明见 docs/project-file-format.md */
export const PROJECT_FORMAT = "level-layout-designer";
/**
 * 版本 3：内容按楼层保存在 floors 中。
 * 版本 1/2 的文件（顶层 cells / vectors）导入时视为“第一层”。
 */
export const PROJECT_VERSION = 3;

export interface FloorData {
  /** 楼层号：1 = 第一层，2 = 第二层，-1 = 负一层……没有 0 */
  level: number;
  cells: Cell[];
  vectors: VectorShape[];
  /** 备注（可选，旧文件没有） */
  notes: Note[];
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  grid: { cellSize: number; subdivision: number };
  view: { x: number; y: number; zoom: number };
  legend: { name: string; color: string }[];
  currentFloor: number;
  floors: FloorData[];
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
export function sanitizeFloors(list: unknown): FloorData[] {
  const out: FloorData[] = [];
  const seen = new Set<number>();
  if (Array.isArray(list)) {
    for (const f of list as any[]) {
      if (!f || !Number.isInteger(f.level) || f.level === 0 || seen.has(f.level)) continue;
      seen.add(f.level);
      out.push({ level: f.level, cells: sanitizeCells(f.cells), vectors: sanitizeVectors(f.vectors), notes: sanitizeNotes(f.notes) });
    }
  }
  if (!out.length) out.push({ level: 1, cells: [], vectors: [], notes: [] });
  return out.sort((a, b) => b.level - a.level);
}

/** 校验并规范化一个导入的工程文件；格式不对时抛出带中文说明的错误 */
export function parseProject(text: string): ProjectFile {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON。");
  }
  if (!data || data.format !== PROJECT_FORMAT) throw new Error("这不是关卡 Layout 设计器的工程文件。");
  if (typeof data.version !== "number" || data.version > PROJECT_VERSION) {
    throw new Error("工程文件版本比当前工具新，请使用新版工具打开。");
  }
  const legend = Array.isArray(data.legend)
    ? data.legend.filter((e: any) => e && typeof e.name === "string" && HEX.test(e.color))
        .map((e: any) => ({ name: e.name, color: e.color.toLowerCase() }))
    : [];
  const v = data.view;
  const view = v && [v.x, v.y, v.zoom].every((n) => typeof n === "number" && isFinite(n)) && v.zoom > 0
    ? { x: v.x, y: v.y, zoom: v.zoom }
    : { x: 0, y: 0, zoom: 1 };
  const floors = Array.isArray(data.floors)
    ? sanitizeFloors(data.floors)
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
  };
}

/** 楼层显示名：1 → 第一层，-1 → 负一层 */
export function floorName(level: number): string {
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
  const base = (name.trim() || "未命名关卡").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 80);
  return `${base}.json`;
}
