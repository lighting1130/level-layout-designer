import type { Cell } from "./cells";

/** 工程文件格式（.json）。字段说明见 docs/project-file-format.md */
export const PROJECT_FORMAT = "level-layout-designer";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  grid: { cellSize: number; subdivision: number };
  view: { x: number; y: number; zoom: number };
  legend: { name: string; color: string }[];
  cells: Cell[];
}

const HEX = /^#[0-9a-f]{6}$/i;

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
  const cells: Cell[] = Array.isArray(data.cells)
    ? data.cells.filter(
        (c: any) => c && Number.isInteger(c.k) && Number.isInteger(c.i) && Number.isInteger(c.j) && typeof c.color === "string" && HEX.test(c.color),
      ).map((c: any) => ({ k: c.k, i: c.i, j: c.j, color: c.color.toLowerCase() }))
    : [];
  const legend = Array.isArray(data.legend)
    ? data.legend.filter((e: any) => e && typeof e.name === "string" && HEX.test(e.color))
        .map((e: any) => ({ name: e.name, color: e.color.toLowerCase() }))
    : [];
  const v = data.view;
  const view = v && [v.x, v.y, v.zoom].every((n) => typeof n === "number" && isFinite(n)) && v.zoom > 0
    ? { x: v.x, y: v.y, zoom: v.zoom }
    : { x: 0, y: 0, zoom: 1 };
  return {
    format: PROJECT_FORMAT,
    version: data.version,
    name: typeof data.name === "string" ? data.name : "",
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
    grid: { cellSize: 32, subdivision: 10 },
    view,
    legend,
    cells,
  };
}

/** 把工程名变成安全的文件名 */
export function projectFileName(name: string): string {
  const base = (name.trim() || "未命名关卡").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 80);
  return `${base}.json`;
}
