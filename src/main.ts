import { Camera } from "./camera";
import { CELL_SIZE, SUBDIVISION, brushLevel, drawBackground, drawGrid, finestLevel, levelStep } from "./grid";
import { CellLayer, type Cell, type Change } from "./cells";
import { MAX_SHAPE_CELLS, SHAPE_LABELS, TooManyCellsError, arcPoints, rasterizeFill, rasterizeThickStroke, clampSides, shapePolygon, type CellIJ, type Pt, type ShapeKind } from "./shapes";
import { drawVector, drawVectors, hitVector, isClosed, moveVector, vectorBounds, sanitizeVectors, type VectorShape } from "./vectors";
import { PROJECT_FORMAT, PROJECT_VERSION, floorName, parseProject, projectFileName, sanitizeFloors, type FloorData, type ProjectFile } from "./project";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const $ = (id: string) => document.getElementById(id)!;
const hudCell = $("hud-cell");
const hudZoom = $("hud-zoom");
const hudBrush = $("hud-brush");
const hudFloor = $("hud-floor");
const hintEl = $("hint");
const currentSwatch = $("current-swatch");

const cam = new Camera();
/** 当前楼层的格子层（切换楼层时指向那一层的数据） */
let layer = new CellLayer();
let width = 0;
let height = 0;
let dirty = true;
const requestRender = () => { dirty = true; };

// ---------------- 颜色说明（右侧面板，可编辑） ----------------
interface LegendEntry { id: number; name: string; color: string }
/** 默认按关卡元素命名，用户可以改名、改色、增删；按 1-9 快速切换前 9 个 */
const DEFAULT_LEGEND: Omit<LegendEntry, "id">[] = [
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
const LEGEND_KEY = "level-layout-designer.legend.v1";
let nextId = 1;
let legend: LegendEntry[] = DEFAULT_LEGEND.map((e) => ({ ...e, id: nextId++ }));
try {
  const raw = localStorage.getItem(LEGEND_KEY);
  const saved = raw ? JSON.parse(raw) : null;
  if (Array.isArray(saved) && saved.length) {
    legend = saved
      .filter((e) => e && typeof e.name === "string" && /^#[0-9a-f]{6}$/i.test(e.color))
      .map((e) => ({ id: nextId++, name: e.name, color: e.color.toLowerCase() }));
  }
} catch { /* 忽略 */ }
let selectedId = legend[0]?.id ?? 0;
let currentColor = legend[0]?.color ?? "#8b93a3";

const legendList = $("legend-list");
const legendPanel = $("legend");

function saveLegend() {
  try { localStorage.setItem(LEGEND_KEY, JSON.stringify(legend.map(({ name, color }) => ({ name, color })))); } catch { /* 忽略 */ }
}

function selectEntry(id: number) {
  const e = legend.find((x) => x.id === id);
  if (!e) return;
  selectedId = id;
  currentColor = e.color;
  for (const row of legendList.querySelectorAll<HTMLElement>(".legend-row")) {
    row.classList.toggle("selected", Number(row.dataset.id) === id);
  }
  if (tool === "eraser") setTool("brush");
  requestRender();
}

/** 修改某个颜色时，把画布上（以及撤销记录里）用这个颜色的格子一起改掉，保持图例和画面一致 */
function recolor(from: string, to: string) {
  if (from === to) return;
  syncFloor();
  for (const f of floors) f.layer.recolor(from, to);
  // 平滑图形对象在各楼层和撤销记录之间共享，统一改一次即可
  const shapes = new Set<VectorShape>();
  for (const f of floors) f.vectors.forEach((v) => shapes.add(v));
  for (const stack of [undoStack, redoStack]) for (const e of stack) e.vectors?.forEach((v) => shapes.add(v));
  for (const v of shapes) if (v.color === from) v.color = to;
  for (const stack of [undoStack, redoStack]) {
    for (const ch of stack) for (const c of ch.cells.values()) if (c && c.color === from) c.color = to;
  }
  save();
  requestRender();
}

function renderLegend() {
  legendList.replaceChildren();
  legend.forEach((e, idx) => {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.dataset.id = String(e.id);
    row.classList.toggle("selected", e.id === selectedId);
    row.addEventListener("pointerdown", () => selectEntry(e.id));

    const sw = document.createElement("label");
    sw.className = "legend-swatch";
    sw.style.background = e.color;
    sw.title = "点击修改颜色";
    const ci = document.createElement("input");
    ci.type = "color";
    ci.value = e.color;
    ci.id = `legend-color-${e.id}`;
    ci.setAttribute("aria-label", `${e.name} 的颜色`);
    ci.addEventListener("input", () => {
      const to = ci.value.toLowerCase();
      recolor(e.color, to);
      e.color = to;
      sw.style.background = to;
      if (selectedId === e.id) currentColor = to;
      saveLegend();
    });
    sw.appendChild(ci);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "legend-name";
    name.id = `legend-name-${e.id}`;
    name.value = e.name;
    name.placeholder = "说明";
    name.setAttribute("aria-label", "颜色说明");
    name.addEventListener("input", () => { e.name = name.value; saveLegend(); });
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === "Escape") name.blur(); });

    const key = document.createElement("span");
    key.className = "legend-key";
    key.textContent = idx < 9 ? String(idx + 1) : "";

    const del = document.createElement("button");
    del.className = "legend-del";
    del.textContent = "×";
    del.title = "删除这个颜色（已画的格子保留）";
    del.setAttribute("aria-label", `删除 ${e.name}`);
    del.disabled = legend.length <= 1;
    del.addEventListener("click", (ev) => {
      ev.stopPropagation();
      legend = legend.filter((x) => x.id !== e.id);
      if (selectedId === e.id) { selectedId = legend[0].id; currentColor = legend[0].color; }
      saveLegend();
      renderLegend();
    });

    row.append(sw, name, key, del);
    legendList.appendChild(row);
  });
}

$("legend-add").addEventListener("click", () => {
  // 新颜色取一个色相与现有颜色尽量不同的颜色
  const hue = (legend.length * 137.5) % 360;
  const color = hslToHex(hue, 55, 60);
  const e = { id: nextId++, name: `新颜色 ${legend.length + 1}`, color };
  legend.push(e);
  saveLegend();
  renderLegend();
  selectEntry(e.id);
  const input = document.getElementById(`legend-name-${e.id}`) as HTMLInputElement | null;
  input?.focus();
  input?.select();
});
$("legend-reset").addEventListener("click", () => {
  legend = DEFAULT_LEGEND.map((e) => ({ ...e, id: nextId++ }));
  saveLegend();
  renderLegend();
  selectEntry(legend[0].id);
});
$("legend-toggle").addEventListener("click", () => {
  const collapsed = legendPanel.classList.toggle("collapsed");
  $("legend-toggle").textContent = collapsed ? "展开" : "收起";
  $("legend-toggle").setAttribute("aria-expanded", String(!collapsed));
});
if (window.innerWidth < 640) $("legend-toggle").click();

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

// ---------------- 工具 ----------------
type Tool = "select" | "brush" | "eraser" | "arc" | "shape" | "hand";
let tool: Tool = "brush";
let spaceDown = false;

function setTool(t: Tool) {
  if (t !== tool) { cancelDraft(); if (t !== "select") clearSelection(); }
  tool = t;
  shapeOptions.hidden = t !== "shape";
  $("tool-options").hidden = t !== "shape" && t !== "arc";
  $("sides-row").hidden = t !== "shape" || shapeKindSel.value !== "polygon";
  strokeOptions.hidden = t !== "shape" && t !== "arc";
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

// 图形选项：类型下拉框 + 是否填充
const shapeOptions = $("shape-options");
const shapeKindSel = $("shape-kind") as HTMLSelectElement;
const shapeFill = $("shape-fill") as HTMLInputElement;
for (const [k, label] of Object.entries(SHAPE_LABELS)) {
  const o = document.createElement("option");
  o.value = k;
  o.textContent = label;
  shapeKindSel.appendChild(o);
}
shapeKindSel.value = "rect";
shapeKindSel.addEventListener("change", () => { setTool("shape"); shapeKindSel.blur(); updateSidesRow(); });
// 多边形边数（3–64），选“多边形”时显示
const sidesInput = $("shape-sides") as HTMLInputElement;
const SIDES_KEY = "level-layout-designer.sides.v1";
let sides = 5;
try { sides = clampSides(Number(localStorage.getItem(SIDES_KEY)) || 5); } catch { /* 忽略 */ }
sidesInput.value = String(sides);
function setSides(n: number) {
  sides = clampSides(n);
  sidesInput.value = String(sides);
  try { localStorage.setItem(SIDES_KEY, String(sides)); } catch { /* 忽略 */ }
  updateDraftCells();
  requestRender();
}
function updateSidesRow() { $("sides-row").hidden = tool !== "shape" || shapeKindSel.value !== "polygon"; }
sidesInput.addEventListener("change", () => { setSides(Number(sidesInput.value)); sidesInput.blur(); });
sidesInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") sidesInput.blur(); });
$("sides-dec").addEventListener("click", () => setSides(sides - 1));
$("sides-inc").addEventListener("click", () => setSides(sides + 1));
updateSidesRow();
shapeFill.addEventListener("change", () => { shapeFill.blur(); setTool("shape"); updateDraftCells(); requestRender(); });

// 线条粗细（弧线和图形共用），单位是当前笔刷格子
const strokeOptions = $("stroke-options");
const strokeInput = $("stroke-width") as HTMLInputElement;
const STROKE_KEY = "level-layout-designer.stroke.v1";
// 绘制模式：格子（逐格填色）或平滑（矢量线条）
const SMOOTH_KEY = "level-layout-designer.smooth.v1";
let smooth = false;
try { smooth = localStorage.getItem(SMOOTH_KEY) === "1"; } catch { /* 忽略 */ }
let strokeWidth = 1;
/** 格子模式只能是整数格；平滑模式可以细到 0.1 格 */
function clampStroke(n: number) {
  if (!isFinite(n) || n <= 0) n = smooth ? 0.1 : 1;
  return smooth ? Math.max(0.1, Math.min(99, Math.round(n * 10) / 10)) : Math.max(1, Math.min(99, Math.round(n)));
}
try { strokeWidth = clampStroke(Number(localStorage.getItem(STROKE_KEY)) || 1); } catch { /* 忽略 */ }
strokeInput.value = String(strokeWidth);
function strokeStep(dir: 1 | -1) {
  if (!smooth) return setStroke(strokeWidth + dir);
  // 平滑模式：1 格以下每次 0.1，以上每次 0.5
  const step = strokeWidth < 1 || (dir < 0 && strokeWidth <= 1) ? 0.1 : 0.5;
  setStroke(strokeWidth + dir * step);
}
function setSmooth(on: boolean) {
  smooth = on;
  try { localStorage.setItem(SMOOTH_KEY, on ? "1" : "0"); } catch { /* 忽略 */ }
  $("mode-cells").setAttribute("aria-pressed", String(!on));
  $("mode-smooth").setAttribute("aria-pressed", String(on));
  strokeInput.step = on ? "0.1" : "1";
  strokeInput.min = on ? "0.1" : "1";
  cancelDraft();
  setStroke(strokeWidth);
}
$("mode-cells").addEventListener("click", () => setSmooth(false));
$("mode-smooth").addEventListener("click", () => setSmooth(true));
function setStroke(n: number) {
  strokeWidth = clampStroke(n);
  strokeInput.value = String(strokeWidth);
  try { localStorage.setItem(STROKE_KEY, String(strokeWidth)); } catch { /* 忽略 */ }
  updateDraftCells();
  requestRender();
}
strokeInput.addEventListener("change", () => { setStroke(Number(strokeInput.value)); strokeInput.blur(); });
strokeInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") strokeInput.blur(); });
$("stroke-dec").addEventListener("click", () => strokeStep(-1));
$("stroke-inc").addEventListener("click", () => strokeStep(1));

// ---------------- 撤销 / 重做 ----------------
/** 一步撤销：格子的修改记录 + （若有改动）修改前的平滑图形列表 */
interface Entry { floor: number; cells: Change; vectors?: VectorShape[] }
const undoStack: Entry[] = [];
const redoStack: Entry[] = [];
/** 当前楼层的平滑图形（画在格子和网格之上）；切换楼层时与 floors 同步 */
let vectors: VectorShape[] = [];

// ---------------- 楼层 ----------------
interface Floor { level: number; layer: CellLayer; vectors: VectorShape[] }
/** 按楼层号从高到低排列 */
let floors: Floor[] = [{ level: 1, layer, vectors }];
let currentLevel = 1;
const currentFloor = () => floors.find((f) => f.level === currentLevel)!;
/** 把当前楼层的 vectors 写回楼层对象 */
function syncFloor() { currentFloor().vectors = vectors; }

function switchFloor(level: number) {
  if (!floors.some((f) => f.level === level)) return;
  if (level === currentLevel) return;
  endStroke();
  cancelDraft();
  clearSelection();
  syncFloor();
  currentLevel = level;
  layer = currentFloor().layer;
  vectors = currentFloor().vectors;
  renderFloors();
  save();
  requestRender();
}

function addFloor(dir: 1 | -1) {
  syncFloor();
  const levels = floors.map((f) => f.level);
  let level = dir > 0 ? Math.max(...levels) + 1 : Math.min(...levels) - 1;
  if (level === 0) level = dir;
  floors.push({ level, layer: new CellLayer(), vectors: [] });
  floors.sort((a, b) => b.level - a.level);
  switchFloor(level);
  renderFloors();
  save();
  toast(`已添加${floorName(level)}`);
}

let deleteArmed = 0;
function deleteCurrentFloor(btn: HTMLButtonElement) {
  if (floors.length <= 1) return;
  // 删除不可撤销：第一次点击变成“确认删除”，3 秒内再点一次才删除
  if (!deleteArmed) {
    btn.textContent = "确认删除？";
    btn.classList.add("danger");
    deleteArmed = window.setTimeout(() => { deleteArmed = 0; renderFloors(); }, 3000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = 0;
  clearSelection();
  const removed = currentLevel;
  floors = floors.filter((f) => f.level !== removed);
  for (const stack of [undoStack, redoStack]) {
    for (let n = stack.length - 1; n >= 0; n--) if (stack[n].floor === removed) stack.splice(n, 1);
  }
  const next = floors.reduce((best, f) => (Math.abs(f.level - removed) < Math.abs(best.level - removed) ? f : best));
  currentLevel = next.level;
  layer = next.layer;
  vectors = next.vectors;
  renderFloors();
  afterEdit();
  toast(`已删除${floorName(removed)}`);
}

/** 非当前楼层的不透明度：每远一层乘 0.4，太淡就不画 */
const FLOOR_FADE = 0.4;
const floorAlpha = (level: number) => {
  // 楼层号跳过 0，所以 1 层和 -1 层相邻
  const idx = (l: number) => (l > 0 ? l - 1 : l);
  return Math.pow(FLOOR_FADE, Math.abs(idx(level) - idx(currentLevel)));
};
let showOtherFloors = true;

const floorList = $("floor-list");
function renderFloors() {
  floorList.replaceChildren();
  for (const f of floors) {
    const b = document.createElement("button");
    b.className = "floor-row";
    b.setAttribute("aria-pressed", String(f.level === currentLevel));
    const count = f.layer.size + (f.level === currentLevel ? vectors.length : f.vectors.length);
    const name = document.createElement("span");
    name.textContent = floorName(f.level);
    const meta = document.createElement("span");
    meta.className = "floor-meta";
    meta.textContent = f.level === currentLevel ? "当前" : count ? String(count) : "";
    b.title = `${floorName(f.level)}：${count} 个格子/图形（PageUp / PageDown 切换）`;
    b.append(name, meta);
    b.addEventListener("click", () => switchFloor(f.level));
    floorList.appendChild(b);
  }
  const del = $("floor-del") as HTMLButtonElement;
  del.disabled = floors.length <= 1;
  if (!deleteArmed) { del.textContent = "删除当前层"; del.classList.remove("danger"); }
}
$("floor-add-up").addEventListener("click", () => addFloor(1));
$("floor-add-down").addEventListener("click", () => addFloor(-1));
$("floor-del").addEventListener("click", (e) => deleteCurrentFloor(e.currentTarget as HTMLButtonElement));
const showOthersInput = $("floor-show-others") as HTMLInputElement;
showOthersInput.addEventListener("change", () => { showOtherFloors = showOthersInput.checked; showOthersInput.blur(); requestRender(); });
function stepFloor(dir: 1 | -1) {
  const idx = floors.findIndex((f) => f.level === currentLevel);
  const next = floors[idx - dir]; // 列表从高到低
  if (next) switchFloor(next.level);
}
const btnUndo = $("btn-undo") as HTMLButtonElement;
const btnRedo = $("btn-redo") as HTMLButtonElement;

function commit(change: Change, vectorsBefore?: VectorShape[]) {
  if (change.size === 0 && !vectorsBefore) return;
  undoStack.push({ floor: currentLevel, cells: change, vectors: vectorsBefore });
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  afterEdit();
}
function undo() {
  const c = undoStack.pop();
  if (!c) return;
  redoStack.push(applyEntry(c));
  afterEdit();
}
function redo() {
  const c = redoStack.pop();
  if (!c) return;
  undoStack.push(applyEntry(c));
  afterEdit();
}
function applyEntry(e: Entry): Entry {
  clearSelection();
  // 撤销/重做发生在别的楼层时，先切换过去，让用户看到变化
  if (e.floor !== currentLevel) switchFloor(e.floor);
  const inv: Entry = { floor: e.floor, cells: layer.apply(e.cells) };
  if (e.vectors) { inv.vectors = vectors; vectors = e.vectors; }
  return inv;
}
function afterEdit() {
  renderFloors();
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
  const before = vectors.length ? vectors : undefined;
  vectors = [];
  commit(ch, before);
});

// ---------------- 本地保存（刷新页面不丢） ----------------
const STORAGE_KEY = "level-layout-designer.cells.v1";
const VECTOR_KEY = "level-layout-designer.vectors.v1";
const FLOORS_KEY = "level-layout-designer.floors.v1";
function floorData(): FloorData[] {
  syncFloor();
  return floors.map((f) => ({ level: f.level, cells: f.layer.toJSON(), vectors: f.vectors }));
}
function loadFloors(data: FloorData[], current: number) {
  floors = sanitizeFloors(data).map((f) => {
    const l = new CellLayer();
    l.load(f.cells);
    return { level: f.level, layer: l, vectors: f.vectors };
  });
  const cur = floors.find((f) => f.level === current) ?? floors.find((f) => f.level === 1) ?? floors[0];
  currentLevel = cur.level;
  layer = cur.layer;
  vectors = cur.vectors;
}
let saveTimer = 0;
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    localStorage.setItem(FLOORS_KEY, JSON.stringify({ current: currentLevel, floors: floorData() }));
  } catch { /* 存储不可用时忽略 */ }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 300);
}
// 关闭或刷新页面前立即保存，避免丢失最后一笔
window.addEventListener("pagehide", () => { if (saveTimer) flushSave(); });
try {
  const rawF = localStorage.getItem(FLOORS_KEY);
  if (rawF) {
    const d = JSON.parse(rawF);
    loadFloors(d.floors, d.current);
  } else {
    // 旧版本只有一层：迁移为第一层
    const raw = localStorage.getItem(STORAGE_KEY);
    const rawV = localStorage.getItem(VECTOR_KEY);
    loadFloors([{ level: 1, cells: raw ? JSON.parse(raw) : [], vectors: rawV ? sanitizeVectors(JSON.parse(rawV)) : [] }], 1);
  }
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
  if (hover && !draft && smooth && (tool === "arc" || tool === "shape") && mode !== "pan" && !spaceDown) {
    // 平滑模式：显示吸附到的网格交点
    const p = snapPoint(hover.x, hover.y, activeLevel());
    const q = cam.worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = currentColor;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return;
  }
  if (tool === "select") {
    canvas.style.cursor = mode === "move" ? "grabbing" : hover && selection && inSelection(cam.screenToWorld(hover.x, hover.y)) ? "move" : "default";
    return;
  }
  canvas.style.cursor = "";
  if (!hover || draft || mode === "pan" || mode === "pinch" || tool === "hand" || spaceDown) return;
  const c = cellAt(hover.x, hover.y, activeLevel());
  const s = levelStep(c.k);
  const p0 = cam.worldToScreen(c.i * s, c.j * s);
  const p1 = cam.worldToScreen((c.i + 1) * s, (c.j + 1) * s);
  const x0 = Math.round(p0.x), y0 = Math.round(p0.y), x1 = Math.round(p1.x), y1 = Math.round(p1.y);
  if (tool !== "eraser") {
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
    // 其他楼层按距离变淡：先画远的，再画近的，当前层最后、完全不透明
    const others = showOtherFloors
      ? floors.filter((f) => f.level !== currentLevel && floorAlpha(f.level) >= 0.03)
          .sort((a, b) => floorAlpha(a.level) - floorAlpha(b.level))
      : [];
    for (const f of others) {
      ctx.globalAlpha = floorAlpha(f.level);
      f.layer.draw(ctx, cam, width, height);
    }
    ctx.globalAlpha = 1;
    // 拖动选区时，原位置的内容先隐藏，只在新位置预览
    const hidden = moveDrag && selection ? new Set(selection.cells.map(cellKey)) : undefined;
    const hiddenVec = moveDrag && selection ? new Set(selection.vectors) : undefined;
    layer.draw(ctx, cam, width, height, hidden);
    drawGrid(ctx, cam, width, height);
    for (const f of others) drawVectors(ctx, cam, f.vectors, floorAlpha(f.level));
    drawVectors(ctx, cam, hiddenVec ? vectors.filter((v) => !hiddenVec.has(v)) : vectors);
    drawDraft();
    drawSelection();
    drawHover();
    currentSwatch.style.background = currentColor;
    const hint = draftHint();
    hintEl.textContent = hint;
    hintEl.hidden = !hint;
    hudZoom.textContent = formatZoom(cam.zoom);
    hudBrush.textContent = `笔刷: ${formatCellSize(activeLevel())}`;
    hudFloor.textContent = floorName(currentLevel);
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
type Mode = "none" | "paint" | "draw" | "pan" | "pinch" | "marquee" | "move";
let mode: Mode = "none";
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let stroke: { change: Change; k: number; last: { x: number; y: number }; vectorsBefore?: VectorShape[] } | null = null;

/** 一笔之内锁定格子层级，避免中途缩放导致粗细混杂 */
function activeLevel() {
  return stroke ? stroke.k : draft ? draft.k : brushLevel(cam.zoom);
}

function localPoint(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function applyBrushAt(sx: number, sy: number) {
  if (!stroke) return false;
  const c = cellAt(sx, sy, stroke.k);
  if (tool === "eraser") {
    let changed = layer.erase(c.k, c.i, c.j, stroke.change);
    // 橡皮碰到的平滑图形整条删除
    const w = cam.screenToWorld(sx, sy);
    const tol = Math.max(levelStep(stroke.k) / 2, 4 / cam.zoom);
    const kept = vectors.filter((v) => !hitVector(v, w.x, w.y, tol));
    if (kept.length !== vectors.length) {
      if (!stroke.vectorsBefore) stroke.vectorsBefore = vectors;
      vectors = kept;
      changed = true;
    }
    return changed;
  }
  return layer.paint(c.k, c.i, c.j, currentColor, stroke.change);
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
    commit(stroke.change, stroke.vectorsBefore);
    stroke = null;
  }
}

// ---------------- 弧线与几何图形 ----------------
/**
 * 弧线：按下设起点，拖到终点松开（或点击起点、再点击终点），
 * 然后移动鼠标调整弯曲程度，再点击确认。Esc 取消。
 * 图形：从一个角拖到对角，松开即生成；按住 Shift 画正方形/正圆/正多边形。
 * 起点、终点都会吸附到格子中心；结果按当前笔刷层级逐格涂色，一次可撤销。
 */
interface Draft {
  kind: "arc" | ShapeKind;
  k: number;
  a: Pt;
  b: Pt;
  bend: Pt | null;
  /** drag: 正在拖终点；pickEnd: 等待点击终点；bend: 调整弯曲；bendDrag: 按住调整弯曲 */
  phase: "drag" | "pickEnd" | "bend" | "bendDrag";
  constrain: boolean;
  /** 平滑模式：生成矢量图形而不是格子 */
  smooth: boolean;
  cells: CellIJ[];
  tooMany: boolean;
}
let draft: Draft | null = null;

/** 格子模式吸附到格子中心，平滑模式吸附到网格交点 */
function snapPoint(sx: number, sy: number, k: number): Pt {
  if (!smooth) return snapToCellCenter(sx, sy, k);
  const w = cam.screenToWorld(sx, sy);
  const s = levelStep(k);
  return { x: Math.round(w.x / s) * s, y: Math.round(w.y / s) * s };
}

function snapToCellCenter(sx: number, sy: number, k: number): Pt {
  const w = cam.screenToWorld(sx, sy);
  const s = levelStep(k);
  return { x: (Math.floor(w.x / s) + 0.5) * s, y: (Math.floor(w.y / s) + 0.5) * s };
}

function draftGeometry(d: Draft): { pts: Pt[]; closed: boolean } {
  if (d.kind === "arc") return { pts: d.bend ? arcPoints(d.a, d.b, d.bend) : [d.a, d.b], closed: false };
  return shapePolygon(d.kind, d.a, d.b, d.constrain, sides);
}

function updateDraftCells() {
  if (!draft) return;
  if (draft.smooth) { draft.cells = []; draft.tooMany = false; return; }
  const s = levelStep(draft.k);
  const g = draftGeometry(draft);
  try {
    // 线条按设定的粗细绘制；勾选“填充”时内部也填满
    const outline = rasterizeThickStroke(g.pts, g.closed, s, strokeWidth);
    if (draft.kind !== "arc" && draft.kind !== "line" && shapeFill.checked && g.closed) {
      const seen = new Set(outline.map((c) => c.i + "," + c.j));
      draft.cells = outline.concat(rasterizeFill(g.pts, s).filter((c) => !seen.has(c.i + "," + c.j)));
    } else {
      draft.cells = outline;
    }
    draft.tooMany = false;
  } catch (err) {
    if (!(err instanceof TooManyCellsError)) throw err;
    draft.cells = [];
    draft.tooMany = true;
  }
}

function draftVector(d: Draft): VectorShape {
  return {
    kind: d.kind, a: d.a, b: d.b, bend: d.bend, constrain: d.constrain, color: currentColor,
    width: strokeWidth * levelStep(d.k), fill: isClosed(d) && shapeFill.checked,
    ...(d.kind === "polygon" ? { sides } : {}),
  };
}

function commitDraft() {
  if (!draft) return;
  if (draft.smooth) {
    const before = vectors;
    vectors = [...vectors, draftVector(draft)];
    commit(new Map(), before);
  } else if (draft.tooMany) {
    toast(`图形太大：超过 ${MAX_SHAPE_CELLS.toLocaleString()} 个格子。请缩小视图（笔刷格子变大）后再画。`, true);
  } else {
    const change: Change = new Map();
    for (const c of draft.cells) layer.paint(draft.k, c.i, c.j, currentColor, change);
    commit(change);
  }
  draft = null;
  requestRender();
}

function cancelDraft() {
  if (draft) { draft = null; requestRender(); }
}

function drawDraft() {
  if (!draft) return;
  const s = levelStep(draft.k);
  if (draft.smooth) drawVector(ctx, cam, draftVector(draft), 0.75);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = currentColor;
  for (const c of draft.cells) {
    const x0 = Math.round((c.i * s - cam.x) * cam.zoom), y0 = Math.round((c.j * s - cam.y) * cam.zoom);
    const x1 = Math.round(((c.i + 1) * s - cam.x) * cam.zoom), y1 = Math.round(((c.j + 1) * s - cam.y) * cam.zoom);
    if (x1 < 0 || y1 < 0 || x0 > width || y0 > height) continue;
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }
  ctx.globalAlpha = 1;
  // 精确的几何线 + 起点/终点/控制点标记
  const g = draftGeometry(draft);
  ctx.strokeStyle = draft.tooMany ? "#ff6b6b" : "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  g.pts.forEach((p, n) => {
    const q = cam.worldToScreen(p.x, p.y);
    n ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  if (g.closed) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const dot = (p: Pt, fill: string) => {
    const q = cam.worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "#1e2127";
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  if (draft.kind === "arc") {
    dot(draft.a, "#7ac878");
    dot(draft.b, "#e86b6b");
    if (draft.bend) dot(draft.bend, "#7aa2f7");
  }
}

function draftHint(): string {
  if (tool === "arc") {
    if (!draft) return "弧线：按下设起点，拖到终点松开";
    if (draft.phase === "pickEnd" || draft.phase === "drag") return "弧线：选择终点";
    return "弧线：移动鼠标调整弯曲，点击确认（Esc 取消）";
  }
  if (tool === "select") return selection ? "拖动选区移动 · 方向键微调 · Delete 删除 · Esc 取消" : "框选：拖出一个框选中内容（Ctrl+A 全选当前层）";
  if (tool === "shape") return draft ? "松开生成；按住 Shift 画正图形" : "图形：从一个角拖到对角";
  return "";
}

// ---------------- 框选与移动 ----------------
/**
 * 框选工具：在当前楼层拖出一个框，格子中心在框内的格子、完全在框内的平滑图形被选中。
 * 在选区内按下拖动即可移动，移动距离对齐到格子（取选区中最粗一级格子的大小）。
 * Delete 删除、方向键微调、Esc 取消、Ctrl+A 全选当前层。
 */
interface Selection {
  cells: Cell[];
  vectors: VectorShape[];
  box: { x0: number; y0: number; x1: number; y1: number };
  /** 移动的最小步长（世界坐标） */
  step: number;
}
let selection: Selection | null = null;
let marquee: { a: Pt; b: Pt } | null = null;
let moveDrag: { start: Pt; dx: number; dy: number } | null = null;

function clearSelection() {
  if (selection || marquee) { selection = null; marquee = null; moveDrag = null; requestRender(); }
}

function makeSelection(cells: Cell[], vecs: VectorShape[]): Selection | null {
  if (!cells.length && !vecs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let step = levelStep(brushLevel(cam.zoom));
  for (const c of cells) {
    const s = levelStep(c.k);
    step = Math.max(step, s);
    x0 = Math.min(x0, c.i * s); y0 = Math.min(y0, c.j * s);
    x1 = Math.max(x1, (c.i + 1) * s); y1 = Math.max(y1, (c.j + 1) * s);
  }
  for (const v of vecs) {
    const b = vectorBounds(v);
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  return { cells, vectors: vecs, box: { x0, y0, x1, y1 }, step };
}

function selectInRect(a: Pt, b: Pt) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const cells = layer.cellsInRect(x0, y0, x1, y1);
  const vecs = vectors.filter((v) => { const r = vectorBounds(v); return r.x0 >= x0 && r.y0 >= y0 && r.x1 <= x1 && r.y1 <= y1; });
  selection = makeSelection(cells, vecs);
}

function selectAll() {
  setTool("select");
  selection = makeSelection(layer.cellsInRect(-Infinity, -Infinity, Infinity, Infinity), [...vectors]);
  requestRender();
}

const cellKey = (c: { k: number; i: number; j: number }) => `${c.k}:${c.i}:${c.j}`;

/** 把选区移动 (dx, dy)（世界坐标，已对齐到步长），作为一步可撤销操作 */
function moveSelection(dx: number, dy: number) {
  if (!selection || (dx === 0 && dy === 0)) return;
  const change: Change = new Map();
  for (const c of selection.cells) layer.remove(c.k, c.i, c.j, change);
  const moved = selection.cells.map((c) => {
    const s = levelStep(c.k);
    return { ...c, i: c.i + Math.round(dx / s), j: c.j + Math.round(dy / s) };
  });
  for (const c of moved) layer.paint(c.k, c.i, c.j, c.color, change);
  let before: VectorShape[] | undefined;
  let movedVecs = selection.vectors;
  if (selection.vectors.length) {
    before = vectors;
    const set = new Set(selection.vectors);
    movedVecs = selection.vectors.map((v) => moveVector(v, dx, dy));
    vectors = vectors.filter((v) => !set.has(v)).concat(movedVecs);
  }
  commit(change, before);
  selection = makeSelection(moved, movedVecs);
  if (selection) selection.step = Math.max(selection.step, levelStep(brushLevel(cam.zoom)));
  requestRender();
}

function deleteSelection() {
  if (!selection) return;
  const change: Change = new Map();
  for (const c of selection.cells) layer.remove(c.k, c.i, c.j, change);
  let before: VectorShape[] | undefined;
  if (selection.vectors.length) {
    before = vectors;
    const set = new Set(selection.vectors);
    vectors = vectors.filter((v) => !set.has(v));
  }
  commit(change, before);
  const n = selection.cells.length + selection.vectors.length;
  selection = null;
  toast(`已删除 ${n} 项`);
}

function inSelection(w: Pt) {
  if (!selection) return false;
  const { x0, y0, x1, y1 } = selection.box;
  return w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1;
}

/** 选区预览：拖动中把选中内容画在新位置 */
function drawSelection() {
  const rectScreen = (x0: number, y0: number, x1: number, y1: number) => {
    const p = cam.worldToScreen(x0, y0), q = cam.worldToScreen(x1, y1);
    return [Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(q.x - p.x), Math.round(q.y - p.y)] as const;
  };
  if (marquee) {
    const [x, y, w, h] = rectScreen(Math.min(marquee.a.x, marquee.b.x), Math.min(marquee.a.y, marquee.b.y), Math.max(marquee.a.x, marquee.b.x), Math.max(marquee.a.y, marquee.b.y));
    ctx.fillStyle = "rgba(122,162,247,0.12)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#7aa2f7";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }
  if (!selection) return;
  const dx = moveDrag?.dx ?? 0, dy = moveDrag?.dy ?? 0;
  if (moveDrag) {
    for (const c of selection.cells) {
      const s = levelStep(c.k);
      const [x, y, w, h] = rectScreen(c.i * s + dx, c.j * s + dy, (c.i + 1) * s + dx, (c.j + 1) * s + dy);
      ctx.fillStyle = c.color;
      ctx.fillRect(x - 0.5, y - 0.5, Math.max(1, w), Math.max(1, h));
    }
    for (const v of selection.vectors) drawVector(ctx, cam, moveVector(v, dx, dy));
  }
  const b = selection.box;
  const [x, y, w, h] = rectScreen(b.x0 + dx, b.y0 + dy, b.x1 + dx, b.y1 + dy);
  ctx.strokeStyle = "#7aa2f7";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.fillStyle = "#7aa2f7";
    ctx.fillRect(hx - 3, hy - 3, 6, 6);
  }
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  hover = p;

  if (pointers.size === 2) {
    if (mode === "draw") cancelDraft();
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
  } else if (e.button === 0 && tool === "select") {
    const w = cam.screenToWorld(p.x, p.y);
    if (selection && inSelection(w)) {
      mode = "move";
      moveDrag = { start: w, dx: 0, dy: 0 };
    } else {
      mode = "marquee";
      selection = null;
      marquee = { a: w, b: w };
    }
  } else if (e.button === 0 && (tool === "arc" || tool === "shape")) {
    mode = "draw";
    const k = draft ? draft.k : brushLevel(cam.zoom);
    if (draft && draft.phase === "pickEnd") {
      draft.b = snapPoint(p.x, p.y, k);
      draft.phase = "drag";
    } else if (draft && draft.phase === "bend") {
      draft.bend = cam.screenToWorld(p.x, p.y);
      draft.phase = "bendDrag";
    } else {
      const a = snapPoint(p.x, p.y, k);
      draft = { kind: tool === "arc" ? "arc" : (shapeKindSel.value as ShapeKind), k, a, b: a, bend: null, phase: "drag", constrain: e.shiftKey, smooth, cells: [], tooMany: false };
    }
    updateDraftCells();
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
  // 弧线调整弯曲 / 选择终点阶段：鼠标不用按住
  if (draft && (draft.phase === "bend" || draft.phase === "bendDrag")) {
    draft.bend = cam.screenToWorld(p.x, p.y);
    updateDraftCells();
  } else if (draft && (draft.phase === "pickEnd" || (draft.phase === "drag" && mode === "draw"))) {
    draft.b = snapPoint(p.x, p.y, draft.k);
    draft.constrain = e.shiftKey;
    updateDraftCells();
  }
  const prev = pointers.get(e.pointerId);
  if (!prev) { requestRender(); return; }

  if (mode === "marquee" && marquee) {
    marquee.b = cam.screenToWorld(p.x, p.y);
  } else if (mode === "move" && moveDrag && selection) {
    const w = cam.screenToWorld(p.x, p.y);
    const st = selection.step;
    moveDrag.dx = Math.round((w.x - moveDrag.start.x) / st) * st;
    moveDrag.dy = Math.round((w.y - moveDrag.start.y) / st) * st;
  } else if (mode === "pan") {
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
  if (pointers.size === 0 && mode === "marquee" && marquee) {
    selectInRect(marquee.a, marquee.b);
    marquee = null;
    if (selection) toast(`已选中 ${selection.cells.length + selection.vectors.length} 项：拖动移动，Delete 删除`);
  } else if (pointers.size === 0 && mode === "move" && moveDrag) {
    const { dx, dy } = moveDrag;
    moveDrag = null;
    moveSelection(dx, dy);
  }
  if (pointers.size === 0 && mode === "draw" && draft) {
    if (draft.kind !== "arc" || draft.phase === "bendDrag") {
      commitDraft();
    } else if (draft.phase === "drag") {
      const same = draft.a.x === draft.b.x && draft.a.y === draft.b.y;
      if (same) {
        draft.phase = "pickEnd"; // 只点了一下：等待点击终点
      } else {
        draft.phase = "bend";
        draft.bend = { x: (draft.a.x + draft.b.x) / 2, y: (draft.a.y + draft.b.y) / 2 };
        updateDraftCells();
      }
    }
  }
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
  if (mod && (e.key === "a" || e.key === "A")) { e.preventDefault(); selectAll(); return; }
  if (mod) return;
  if (e.key === " ") {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; canvas.classList.add("space"); requestRender(); }
    return;
  }
  if (e.key === "Escape") { cancelDraft(); clearSelection(); return; }
  if (selection && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); deleteSelection(); return; }
  if (selection && e.key.startsWith("Arrow")) {
    e.preventDefault();
    const st = selection.step * (e.shiftKey ? 10 : 1);
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (d) moveSelection(d[0], d[1]);
    return;
  }
  if (e.key === "v" || e.key === "V") { setTool("select"); return; }
  if (e.key === "Enter" && draft && draft.phase === "bend") { commitDraft(); return; }
  if (e.key === "PageUp") { e.preventDefault(); stepFloor(1); return; }
  if (e.key === "PageDown") { e.preventDefault(); stepFloor(-1); return; }
  if (e.key === "0" || e.key === "Home") resetView();
  else if (e.key === "+" || e.key === "=") zoomCenter(1.25);
  else if (e.key === "-" || e.key === "_") zoomCenter(0.8);
  else if (e.key === "b" || e.key === "B") setTool("brush");
  else if (e.key === "e" || e.key === "E") setTool("eraser");
  else if (e.key === "h" || e.key === "H") setTool("hand");
  else if (e.key === "a" || e.key === "A") setTool("arc");
  else if (e.key === "[") strokeStep(-1);
  else if (e.key === "]") strokeStep(1);
  else if (e.key === "g" || e.key === "G") setTool("shape");
  else if (/^[1-9]$/.test(e.key)) {
    const entry = legend[Number(e.key) - 1];
    if (entry) selectEntry(entry.id);
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

// ---------------- 导出 / 导入工程文件 ----------------
const NAME_KEY = "level-layout-designer.name.v1";
const nameInput = $("project-name") as HTMLInputElement;
try { const n = localStorage.getItem(NAME_KEY); if (n) nameInput.value = n; } catch { /* 忽略 */ }
nameInput.addEventListener("input", () => { try { localStorage.setItem(NAME_KEY, nameInput.value); } catch { /* 忽略 */ } });
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") nameInput.blur(); });

const toastEl = $("toast");
let toastTimer = 0;
function toast(msg: string, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), isError ? 6000 : 3000);
}

function buildProject(): ProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: nameInput.value.trim() || "未命名关卡",
    exportedAt: new Date().toISOString(),
    grid: { cellSize: CELL_SIZE, subdivision: SUBDIVISION },
    view: { x: cam.x + width / 2 / cam.zoom, y: cam.y + height / 2 / cam.zoom, zoom: cam.zoom },
    legend: legend.map(({ name, color }) => ({ name, color })),
    currentFloor: currentLevel,
    floors: floorData(),
  };
}

type Saver = { save(r: { filename: string; data: string }): Promise<unknown> };
async function exportProject() {
  const project = buildProject();
  const filename = projectFileName(project.name);
  const data = JSON.stringify(project, null, 2);
  // 在 claude.ai 在线版里通过平台的下载能力保存；本地运行时用普通的浏览器下载
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (claude) {
    const downloads = (await claude.use("downloads").catch(() => null)) as Saver | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        toast(`已导出 ${filename}（${project.floors.length} 层）`);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "declined") return;
        if (code === "rate_limited") toast("上一个保存窗口还没关闭，请稍后再试。", true);
        else toast("这里无法保存文件，请在浏览器中打开本页面后再导出。", true);
      }
      return;
    }
  }
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${filename}（${project.floors.length} 层）`);
}

function loadProject(p: ProjectFile) {
  endStroke();
  cancelDraft();
  clearSelection();
  loadFloors(p.floors, p.currentFloor);
  renderFloors();
  if (p.legend.length) {
    legend = p.legend.map((e) => ({ ...e, id: nextId++ }));
    saveLegend();
    renderLegend();
    selectEntry(legend[0].id);
  }
  nameInput.value = p.name || "未命名关卡";
  try { localStorage.setItem(NAME_KEY, nameInput.value); } catch { /* 忽略 */ }
  cam.zoom = Math.min(1e9, Math.max(1e-6, p.view.zoom));
  cam.centerOn(p.view.x, p.view.y, width / 2, height / 2);
  // 导入的是另一个工程，旧的撤销记录不再适用
  undoStack.length = 0;
  redoStack.length = 0;
  afterEdit();
  toast(`已导入「${nameInput.value}」（${p.floors.length} 层）`);
}

const fileInput = $("file-import") as HTMLInputElement;
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    loadProject(parseProject(await file.text()));
  } catch (err) {
    toast(`导入失败：${(err as Error).message}`, true);
  }
});
$("btn-export").addEventListener("click", () => void exportProject());
$("btn-import").addEventListener("click", () => fileInput.click());
// 也可以直接把工程文件拖进画布
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  try { loadProject(parseProject(await file.text())); } catch (err) { toast(`导入失败：${(err as Error).message}`, true); }
});
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "s" || e.key === "S") { e.preventDefault(); void exportProject(); }
  else if (e.key === "o" || e.key === "O") { e.preventDefault(); fileInput.click(); }
});

renderFloors();
setSmooth(smooth);
setTool("brush");
renderLegend();
selectEntry(selectedId);
afterEdit();
resize();
resetView();
requestAnimationFrame(frame);
