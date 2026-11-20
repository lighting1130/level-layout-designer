import type { Camera } from "./camera";
import { levelStep } from "./grid";

/** 一个被涂色的格子：层级 k（间距 = levelStep(k)）中第 (i, j) 个格子 */
export interface Cell { k: number; i: number; j: number; color: string }

const key = (k: number, i: number, j: number) => `${k}:${i}:${j}`;

/** 格子在世界坐标中的范围 */
function bounds(k: number, i: number, j: number) {
  const s = levelStep(k);
  return { x0: i * s, y0: j * s, x1: (i + 1) * s, y1: (j + 1) * s };
}

/** 两个格子是否重叠。网格是逐级嵌套的，重叠即"一个包含另一个"。 */
function overlaps(a: { k: number; i: number; j: number }, b: { k: number; i: number; j: number }) {
  const A = bounds(a.k, a.i, a.j);
  const B = bounds(b.k, b.i, b.j);
  const eps = Math.min(levelStep(a.k), levelStep(b.k)) * 1e-6;
  return A.x0 < B.x1 - eps && B.x0 < A.x1 - eps && A.y0 < B.y1 - eps && B.y0 < A.y1 - eps;
}

/** 一次笔画的修改记录，用于撤销：key -> 修改前的格子（undefined 表示原来没有） */
export type Change = Map<string, Cell | undefined>;

export class CellLayer {
  /** Map 保留插入顺序：越后画的越在上层 */
  private cells = new Map<string, Cell>();

  get size() { return this.cells.size; }

  private record(change: Change, k: string) {
    if (!change.has(k)) change.set(k, this.cells.get(k));
  }

  /** 涂一个格子；颜色相同则不做任何事。返回是否有变化 */
  paint(k: number, i: number, j: number, color: string, change: Change): boolean {
    const id = key(k, i, j);
    const old = this.cells.get(id);
    if (old && old.color === color) return false;
    this.record(change, id);
    this.cells.delete(id); // 重新插入，移到最上层
    this.cells.set(id, { k, i, j, color });
    return true;
  }

  /** 擦除与该格子重叠的所有已涂格子（包括更细的和更粗的） */
  erase(k: number, i: number, j: number, change: Change): boolean {
    let changed = false;
    const target = { k, i, j };
    for (const [id, c] of this.cells) {
      if (overlaps(c, target)) {
        this.record(change, id);
        this.cells.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /** 撤销/重做：应用一组"修改前"状态，返回反向的修改记录 */
  apply(change: Change): Change {
    const inverse: Change = new Map();
    for (const [id, prev] of change) {
      inverse.set(id, this.cells.get(id));
      this.cells.delete(id);
      if (prev) this.cells.set(id, prev);
    }
    return inverse;
  }

  /** 把所有 from 颜色的格子改为 to 颜色（颜色说明里改色时使用） */
  recolor(from: string, to: string) {
    for (const c of this.cells.values()) if (c.color === from) c.color = to;
  }

  clear(change: Change) {
    for (const id of [...this.cells.keys()]) {
      this.record(change, id);
      this.cells.delete(id);
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, width: number, height: number) {
    const right = cam.x + width / cam.zoom;
    const bottom = cam.y + height / cam.zoom;
    for (const c of this.cells.values()) {
      const s = levelStep(c.k);
      const x0 = c.i * s, y0 = c.j * s;
      if (x0 > right || y0 > bottom || x0 + s < cam.x || y0 + s < cam.y) continue; // 视口外不画
      // 对齐到像素边界，相邻格子之间不留缝
      const sx0 = Math.round((x0 - cam.x) * cam.zoom);
      const sy0 = Math.round((y0 - cam.y) * cam.zoom);
      const sx1 = Math.round((x0 + s - cam.x) * cam.zoom);
      const sy1 = Math.round((y0 + s - cam.y) * cam.zoom);
      ctx.fillStyle = c.color;
      ctx.fillRect(sx0, sy0, Math.max(1, sx1 - sx0), Math.max(1, sy1 - sy0));
    }
  }

  toJSON(): Cell[] { return [...this.cells.values()]; }

  load(list: unknown) {
    this.cells.clear();
    if (!Array.isArray(list)) return;
    for (const c of list) {
      if (c && Number.isInteger(c.k) && Number.isInteger(c.i) && Number.isInteger(c.j) && typeof c.color === "string") {
        this.cells.set(key(c.k, c.i, c.j), { k: c.k, i: c.i, j: c.j, color: c.color });
      }
    }
  }
}
