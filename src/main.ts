import { Camera } from "./camera";
import { CELL_SIZE, SUBDIVISION, brushLevel, drawBackground, drawGrid, finestLevel, levelStep } from "./grid";
import { CellLayer, type Change } from "./cells";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const $ = (id: string) => document.getElementById(id)!;
const hudCell = $("hud-cell");
const hudZoom = $("hud-zoom");
const hudBrush = $("hud-brush");

const cam = new Camera();
const layer = new CellLayer();
let width = 0;
let height = 0;
let dirty = true;
const requestRender = () => { dirty = true; };

// ---------------- 调色板 ----------------
/** 预设颜色按关卡元素命名，按 1-9 快速切换 */
const PALETTE: { name: string; color: string }[] = [
  { name: "墙体", color: "#8b93a3" },
  { name: "地面", color: "#c9b48a" },
  { name: "草地", color: "#5fa45a" },
  { name: "水域", color: "#3f8fd8" },
  { name: "岩浆/伤害区", color: "#e0613f" },
  { name: "出生点", color: "#f2c14e" },
  { name: "终点/目标", color: "#b07ad9" },
  { name: "敌人", color: "#d9455f" },
  { name: "道具/机关", color: "#4fc1b5" },
];
let currentColor = PALETTE[0].color;
const paletteEl = $("palette");
const customInput = $("color-custom") as HTMLInputElement;
const customLabel = customInput.parentElement!;

PALETTE.forEach((p, idx) => {
  const b = document.createElement("button");
  b.className = "swatch";
  b.style.background = p.color;
  b.title = `${p.name} (${idx + 1})`;
  b.setAttribute("aria-label", p.name);
  b.dataset.color = p.color;
  b.addEventListener("click", () => selectColor(p.color));
  paletteEl.appendChild(b);
});
customInput.addEventListener("input", () => selectColor(customInput.value, true));
customInput.addEventListener("click", () => selectColor(customInput.value, true));

function selectColor(color: string, custom = false) {
  currentColor = color;
  for (const b of paletteEl.querySelectorAll<HTMLButtonElement>(".swatch")) {
    b.setAttribute("aria-pressed", String(!custom && b.dataset.color === color));
  }
  customLabel.classList.toggle("active", custom);
  if (tool === "eraser") setTool("brush");
  requestRender();
}

// ---------------- 工具 ----------------
type Tool = "brush" | "eraser" | "hand";
let tool: Tool = "brush";
let spaceDown = false;

function setTool(t: Tool) {
  tool = t;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tool")) {
    b.setAttribute("aria-pressed", String(b.dataset.tool === t));
  }
  canvas.classList.toggle("tool-hand", t === "hand");
  canvas.classList.toggle("tool-eraser", t === "eraser");
  requestRender();
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".tool")) {
  b.addEventListener("click", () => setTool(b.dataset.tool as Tool));
}

// ---------------- 撤销 / 重做 ----------------
const undoStack: Change[] = [];
const redoStack: Change[] = [];
const btnUndo = $("btn-undo") as HTMLButtonElement;
const btnRedo = $("btn-redo") as HTMLButtonElement;

function commit(change: Change) {
  if (change.size === 0) return;
  undoStack.push(change);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  afterEdit();
}
function undo() {
  const c = undoStack.pop();
  if (!c) return;
  redoStack.push(layer.apply(c));
  afterEdit();
}
function redo() {
  const c = redoStack.pop();
  if (!c) return;
  undoStack.push(layer.apply(c));
  afterEdit();
}
function afterEdit() {
  btnUndo.disabled = undoStack.length === 0;
  btnRedo.disabled = redoStack.length === 0;
  save();
  requestRender();
}
btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);
$("btn-clear").addEventListener("click", () => {
  const ch: Change = new Map();
  layer.clear(ch);
  commit(ch);
});

// ---------------- 本地保存（刷新页面不丢） ----------------
const STORAGE_KEY = "level-layout-designer.cells.v1";
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layer.toJSON())); } catch { /* 存储不可用时忽略 */ }
  }, 300);
}
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) layer.load(JSON.parse(raw));
} catch { /* 忽略损坏或不可用的存储 */ }

// ---------------- 渲染 ----------------
let hover: { x: number; y: number } | null = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  requestRender();
}

function resetView() {
  cam.zoom = 1;
  cam.centerOn(0, 0, width / 2, height / 2);
  requestRender();
}

function cellAt(sx: number, sy: number, k: number) {
  const w = cam.screenToWorld(sx, sy);
  const s = levelStep(k);
  return { k, i: Math.floor(w.x / s), j: Math.floor(w.y / s) };
}

function drawHover() {
  if (!hover || mode === "pan" || mode === "pinch" || tool === "hand" || spaceDown) return;
  const c = cellAt(hover.x, hover.y, activeLevel());
  const s = levelStep(c.k);
  const p0 = cam.worldToScreen(c.i * s, c.j * s);
  const p1 = cam.worldToScreen((c.i + 1) * s, (c.j + 1) * s);
  const x0 = Math.round(p0.x), y0 = Math.round(p0.y), x1 = Math.round(p1.x), y1 = Math.round(p1.y);
  if (tool === "brush") {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = currentColor;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = tool === "eraser" ? "#ff6b6b" : "#ffffff";
  ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
}

function frame() {
  if (dirty) {
    dirty = false;
    drawBackground(ctx, width, height);
    layer.draw(ctx, cam, width, height);
    drawGrid(ctx, cam, width, height);
    drawHover();
    hudZoom.textContent = formatZoom(cam.zoom);
    hudBrush.textContent = `笔刷: ${formatCellSize(activeLevel())}`;
  }
  requestAnimationFrame(frame);
}

function formatZoom(z: number): string {
  const pct = z * 100;
  if (pct >= 1e5 || pct < 0.01) return `${pct.toExponential(1)}%`;
  return `${pct >= 10 ? Math.round(pct) : Number(pct.toPrecision(2))}%`;
}

/** 笔刷格子相对基础格子的大小，如 "1 格"、"10×10 格"、"1/10 格" */
function formatCellSize(k: number): string {
  if (k === 0) return "1 格";
  if (k > 0) {
    const n = Math.pow(SUBDIVISION, k);
    return n < 1e6 ? `${n}×${n} 格` : `10^${k}×10^${k} 格`;
  }
  const n = Math.pow(SUBDIVISION, -k);
  return n < 1e6 ? `1/${n} 格` : `1/10^${-k} 格`;
}

// ---- 鼠标位置 -> 格子坐标（放大细分后显示小数，精度跟随当前最细一级网格） ----
function updateCursorCell(sx: number, sy: number) {
  const w = cam.screenToWorld(sx, sy);
  const decimals = Math.min(12, Math.max(0, -finestLevel(cam.zoom)));
  const f = (v: number) => {
    const scale = Math.pow(10, decimals);
    return (Math.floor((v / CELL_SIZE) * scale) / scale).toFixed(decimals);
  };
  hudCell.textContent = `格子: ${f(w.x)}, ${f(w.y)}`;
}

// ---------------- 指针：涂色 / 平移 / 双指缩放 ----------------
type Mode = "none" | "paint" | "pan" | "pinch";
let mode: Mode = "none";
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let stroke: { change: Change; k: number; last: { x: number; y: number } } | null = null;

/** 一笔之内锁定格子层级，避免中途缩放导致粗细混杂 */
function activeLevel() {
  return stroke ? stroke.k : brushLevel(cam.zoom);
}

function localPoint(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function applyBrushAt(sx: number, sy: number) {
  if (!stroke) return false;
  const c = cellAt(sx, sy, stroke.k);
  return tool === "eraser"
    ? layer.erase(c.k, c.i, c.j, stroke.change)
    : layer.paint(c.k, c.i, c.j, currentColor, stroke.change);
}

/** 沿上一点到当前点插值，快速拖动也不会漏格 */
function paintSegment(a: { x: number; y: number }, b: { x: number; y: number }) {
  if (!stroke) return;
  const cellPx = levelStep(stroke.k) * cam.zoom;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(dist / Math.max(1, cellPx / 3)));
  let changed = false;
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    changed = applyBrushAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t) || changed;
  }
  if (changed) requestRender();
}

function endStroke() {
  if (stroke) {
    commit(stroke.change);
    stroke = null;
  }
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  hover = p;

  if (pointers.size === 2) {
    // 第二根手指落下：取消当前笔画（已画部分保留且可撤销），改为双指平移缩放
    endStroke();
    mode = "pinch";
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    return;
  }
  if (pointers.size > 2) return;

  const wantsPan = e.button === 1 || e.button === 2 || tool === "hand" || spaceDown;
  if (wantsPan) {
    mode = "pan";
    canvas.classList.add("panning");
  } else if (e.button === 0) {
    mode = "paint";
    stroke = { change: new Map(), k: brushLevel(cam.zoom), last: p };
    if (applyBrushAt(p.x, p.y)) requestRender();
  }
  requestRender();
});

canvas.addEventListener("pointermove", (e) => {
  const p = localPoint(e);
  hover = p;
  updateCursorCell(p.x, p.y);
  const prev = pointers.get(e.pointerId);
  if (!prev) { requestRender(); return; }

  if (mode === "pan") {
    cam.panBy(p.x - prev.x, p.y - prev.y);
  } else if (mode === "paint" && stroke) {
    paintSegment(stroke.last, p);
    stroke.last = p;
  } else if (mode === "pinch" && pointers.size === 2) {
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
    const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
    const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
    const dist = Math.hypot(p.x - other.x, p.y - other.y);
    cam.panBy(mid.x - prevMid.x, mid.y - prevMid.y);
    if (pinchDist > 0) cam.zoomAt(mid.x, mid.y, cam.zoom * (dist / pinchDist));
    pinchDist = dist;
  }
  pointers.set(e.pointerId, p);
  requestRender();
});

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    endStroke();
    mode = "none";
    canvas.classList.remove("panning");
    if (e.pointerType !== "mouse") hover = null;
  } else if (mode === "pinch" && pointers.size < 2) {
    pinchDist = 0;
    mode = "pan"; // 抬起一根手指后，剩下的手指继续平移，不会误涂
  }
  requestRender();
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => { if (mode === "none") { hover = null; requestRender(); } });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---- 滚轮：鼠标滚轮缩放；触控板捏合缩放、双指滑动平移；Shift+滚轮横向平移 ----
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const p = localPoint(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey) {
      // 触控板捏合（浏览器会以 ctrl+wheel 形式上报）
      cam.zoomAt(p.x, p.y, cam.zoom * Math.exp(-dy * 0.01));
    } else if (e.shiftKey) {
      cam.panBy(-dy, -dx);
    } else if (dx !== 0) {
      // 触控板双指滑动：平移
      cam.panBy(-dx, -dy);
    } else {
      // 鼠标滚轮：以光标为中心缩放
      cam.zoomAt(p.x, p.y, cam.zoom * Math.exp(-dy * 0.0015));
    }
    hover = p;
    updateCursorCell(p.x, p.y);
    if (stroke) paintSegment(stroke.last, p);
    requestRender();
  },
  { passive: false },
);

// ---------------- 键盘与按钮 ----------------
function zoomCenter(factor: number) {
  cam.zoomAt(width / 2, height / 2, cam.zoom * factor);
  requestRender();
}
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
  if (mod) return;
  if (e.key === " ") {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; canvas.classList.add("space"); requestRender(); }
    return;
  }
  if (e.key === "0" || e.key === "Home") resetView();
  else if (e.key === "+" || e.key === "=") zoomCenter(1.25);
  else if (e.key === "-" || e.key === "_") zoomCenter(0.8);
  else if (e.key === "b" || e.key === "B") setTool("brush");
  else if (e.key === "e" || e.key === "E") setTool("eraser");
  else if (e.key === "h" || e.key === "H") setTool("hand");
  else if (/^[1-9]$/.test(e.key)) {
    const p = PALETTE[Number(e.key) - 1];
    if (p) selectColor(p.color);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") { spaceDown = false; canvas.classList.remove("space"); requestRender(); }
});
window.addEventListener("blur", () => { spaceDown = false; canvas.classList.remove("space"); });
$("btn-zoom-in").addEventListener("click", () => zoomCenter(1.25));
$("btn-zoom-out").addEventListener("click", () => zoomCenter(0.8));
$("btn-reset").addEventListener("click", resetView);
// 按钮点击后把焦点还给画布，避免空格键再次触发按钮
for (const b of document.querySelectorAll("button")) b.addEventListener("mouseup", () => (b as HTMLButtonElement).blur());

window.addEventListener("resize", () => {
  // 保持屏幕中心对应的世界点不变
  const c = cam.screenToWorld(width / 2, height / 2);
  resize();
  cam.centerOn(c.x, c.y, width / 2, height / 2);
});

setTool("brush");
selectColor(PALETTE[0].color);
afterEdit();
resize();
resetView();
requestAnimationFrame(frame);
