import type { Camera } from "./camera";

/** 备注：钉在世界坐标某一点上的一段文字 */
export interface Note { x: number; y: number; text: string }

export function sanitizeNotes(list: unknown): Note[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((n: any) => n && typeof n.x === "number" && typeof n.y === "number" && isFinite(n.x) && isFinite(n.y) && typeof n.text === "string" && n.text.trim())
    .map((n: any) => ({ x: n.x, y: n.y, text: String(n.text).slice(0, 2000) }));
}

export interface NoteBox { note: Note; x0: number; y0: number; x1: number; y1: number }

const FONT = '13px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const MAX_W = 220;
const LINE_H = 18;
const MAX_LINES = 6;
const PAD = 8;

/** 按宽度折行（中文逐字、英文按词） */
function wrap(ctx: CanvasRenderingContext2D, text: string): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of para.match(/[A-Za-z0-9_\-.,!?'"]+\s*|\s+|./gu) ?? [""]) {
      if (ctx.measureText(line + ch).width > MAX_W - PAD * 2 && line) {
        lines.push(line.trimEnd());
        line = ch.trimStart();
      } else line += ch;
    }
    lines.push(line);
  }
  if (lines.length > MAX_LINES) {
    const cut = lines.slice(0, MAX_LINES);
    cut[MAX_LINES - 1] = cut[MAX_LINES - 1].replace(/.?$/u, "…");
    return cut;
  }
  return lines;
}

/**
 * 画备注：一个图钉 + 右上方的便签框，大小不随缩放变化。
 * 返回每个备注在屏幕上的范围，用于点击命中。
 */
export function drawNotes(ctx: CanvasRenderingContext2D, cam: Camera, notes: Note[], alpha = 1, highlight?: Set<Note>): NoteBox[] {
  const boxes: NoteBox[] = [];
  ctx.save();
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.globalAlpha = alpha;
  for (const n of notes) {
    const p = cam.worldToScreen(n.x, n.y);
    const lines = wrap(ctx, n.text);
    const w = Math.min(MAX_W, Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD * 2);
    const h = lines.length * LINE_H + PAD * 2 - 4;
    const bx = Math.round(p.x + 10), by = Math.round(p.y - h - 10);
    // 引线
    ctx.strokeStyle = "#f2c14e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(bx, by + h);
    ctx.stroke();
    // 便签
    ctx.fillStyle = "#fff4c2";
    ctx.strokeStyle = highlight?.has(n) ? "#7aa2f7" : "#c9a227";
    ctx.lineWidth = highlight?.has(n) ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#3a3220";
    lines.forEach((l, k) => ctx.fillText(l, bx + PAD, by + PAD - 2 + k * LINE_H));
    // 图钉
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f2c14e";
    ctx.fill();
    ctx.strokeStyle = "#1e2127";
    ctx.lineWidth = 2;
    ctx.stroke();
    boxes.push({ note: n, x0: Math.min(p.x - 6, bx), y0: by, x1: bx + w, y1: p.y + 6 });
  }
  ctx.restore();
  return boxes;
}
