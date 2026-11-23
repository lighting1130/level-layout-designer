import { Camera } from "./camera";
import { captureStatic, getLang, setLang, t } from "./i18n";
import { CELL_SIZE, SUBDIVISION, brushLevel, drawBackground, drawGrid, finestLevel, levelStep } from "./grid";
import { CellLayer, type Cell, type Change } from "./cells";
import { ARROW_LABELS, arrowHeads, isArrowMode, type ArrowMode, MAX_SHAPE_CELLS, SHAPE_LABELS, TooManyCellsError, arcPoints, rasterizeFill, rasterizeThickStroke, clampSides, shapeBox, shapePolygon, type CellIJ, type Pt, type ShapeKind } from "./shapes";
import { drawVector, drawVectors, hitVector, isClosed, moveVector, rotQuarter, rotateVector, vectorBounds, sanitizeVectors, type VectorShape } from "./vectors";
import { drawNotes, moveNoteLabel, moveNotePin, type Note, type NoteBox } from "./notes";
import { DEFAULT_OPACITY, ImageStore, clampOpacity, drawRefImages, loadImageFile, normAngle, refImageCorners, refImageLocal, type RefImage } from "./refimages";
import { ICONS, customImageId, customKind, drawIconAt, drawIcons, hitIcon, isBuiltinIcon, sanitizeCustomIcons, type CustomIcon, type MapIcon } from "./icons";
import { DEFAULT_EXPORT, canvasToPng, makeZip, renderExport, type ExportOptions } from "./exportimage";
import { DEFAULT_METERS_PER_CELL, formatLength, getMetersPerCell, scaleText, setMetersPerCell, worldToMeters } from "./units";
import { PROJECT_FORMAT, PROJECT_VERSION, floorName, parseProject, projectFileName, sanitizeFloors, sanitizeIconLabels, type FloorData, type ProjectFile } from "./project";

// 先记下页面里写死的中文，之后切换语言时替换（必须在动态生成内容之前）
captureStatic(document.body);
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
  // 框选着内容时选颜色：把选中的格子和线条换成这个颜色
  if (selection && tool === "select") recolorSelection(e.color, e.name);
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
    sw.title = t("点击修改颜色");
    const ci = document.createElement("input");
    ci.type = "color";
    ci.value = e.color;
    ci.id = `legend-color-${e.id}`;
    ci.setAttribute("aria-label", t("{name} 的颜色", { name: t(e.name) }));
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
    name.value = t(e.name);
    name.placeholder = t("说明");
    name.setAttribute("aria-label", t("颜色说明"));
    name.addEventListener("input", () => { e.name = name.value; saveLegend(); });
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === "Escape") name.blur(); });

    const key = document.createElement("span");
    key.className = "legend-key";
    key.textContent = idx < 9 ? String(idx + 1) : "";

    const del = document.createElement("button");
    del.className = "legend-del";
    del.textContent = "×";
    del.title = t("删除这个颜色（已画的格子保留）");
    del.setAttribute("aria-label", t("删除 {name}", { name: t(e.name) }));
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
  const e = { id: nextId++, name: t("新颜色 {n}", { n: legend.length + 1 }), color };
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
  $("legend-toggle").textContent = collapsed ? t("展开") : t("收起");
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
type Tool = "select" | "brush" | "eraser" | "arc" | "shape" | "note" | "icon" | "hand";
let tool: Tool = "brush";
let spaceDown = false;

function setTool(t: Tool) {
  if (t !== tool) { cancelDraft(); if (t !== "select") clearSelection(); }
  tool = t;
  shapeOptions.hidden = t !== "shape";
  $("tool-options").hidden = t !== "shape" && t !== "arc" && t !== "icon";
  $("icon-options").hidden = t !== "icon";
  $("sides-row").hidden = t !== "shape" || shapeKindSel.value !== "polygon";
  strokeOptions.hidden = t !== "shape" && t !== "arc";
  updateSidesRow();
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
/** 下拉框选项的文字跟随语言 */
function relabelOptions() {
  for (const o of shapeKindSel.options) o.textContent = t(SHAPE_LABELS[o.value as ShapeKind]);
  for (const o of arrowSel.options) o.textContent = t(ARROW_LABELS[o.value as ArrowMode]);
}
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
function updateSidesRow() {
  $("sides-row").hidden = tool !== "shape" || shapeKindSel.value !== "polygon";
  $("arrow-row").hidden = !(tool === "arc" || (tool === "shape" && shapeKindSel.value === "line"));
}
// 箭头（弧线和直线）
const arrowSel = $("arrow-mode") as HTMLSelectElement;
const ARROW_KEY = "level-layout-designer.arrow.v1";
let arrow: ArrowMode = "none";
try { const v = localStorage.getItem(ARROW_KEY); if (isArrowMode(v)) arrow = v; } catch { /* 忽略 */ }
for (const [k, label] of Object.entries(ARROW_LABELS)) {
  const o = document.createElement("option");
  o.value = k;
  o.textContent = label;
  arrowSel.appendChild(o);
}
arrowSel.value = arrow;
arrowSel.addEventListener("change", () => {
  if (isArrowMode(arrowSel.value)) arrow = arrowSel.value;
  try { localStorage.setItem(ARROW_KEY, arrow); } catch { /* 忽略 */ }
  arrowSel.blur();
  updateDraftCells();
  requestRender();
});
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
interface Entry { floor: number; cells: Change; vectors?: VectorShape[]; notes?: Note[]; images?: RefImage[]; icons?: MapIcon[] }
const undoStack: Entry[] = [];
const redoStack: Entry[] = [];
/** 当前楼层的平滑图形（画在格子和网格之上）；切换楼层时与 floors 同步 */
let vectors: VectorShape[] = [];

// ---------------- 楼层 ----------------
/** 当前楼层的备注；与 vectors 一样在切换楼层时同步 */
let notes: Note[] = [];
/** 当前楼层的参考图（画在格子下面）；同样在切换楼层时同步 */
let images: RefImage[] = [];
/** 所有参考图的图片数据 */
const imageStore = new ImageStore(requestRender);
/** 框选工具下选中的参考图，以及正在拖动/缩放的参考图（放在这里声明，启动时加载楼层就会用到） */
let imgSel: RefImage | null = null;
let imgDrag: { img: RefImage; kind: "move" | "resize" | "rotate"; start: Pt; startScreen: Pt; dx: number; dy: number; moved: boolean; shift: boolean } | null = null;
/** 当前楼层的关卡图标 */
let icons: MapIcon[] = [];
/** 用户导入的图标库（所有楼层共用） */
let customIcons: CustomIcon[] = [];
interface Floor { level: number; layer: CellLayer; vectors: VectorShape[]; notes: Note[]; images: RefImage[]; icons: MapIcon[] }
/** 按楼层号从高到低排列 */
let floors: Floor[] = [{ level: 1, layer, vectors, notes, images, icons }];
let currentLevel = 1;
const currentFloor = () => floors.find((f) => f.level === currentLevel)!;
/** 把当前楼层的 vectors 写回楼层对象 */
function syncFloor() { const f = currentFloor(); f.vectors = vectors; f.notes = notes; f.images = images; f.icons = icons; }

function switchFloor(level: number) {
  if (!floors.some((f) => f.level === level)) return;
  if (level === currentLevel) return;
  endStroke();
  cancelDraft();
  clearSelection();
  if (editing) closeNoteEditor();
  syncFloor();
  currentLevel = level;
  layer = currentFloor().layer;
  vectors = currentFloor().vectors;
  notes = currentFloor().notes;
  images = currentFloor().images;
  icons = currentFloor().icons;
  imgSel = null;
  renderFloors();
  save();
  requestRender();
}

function addFloor(dir: 1 | -1) {
  syncFloor();
  const levels = floors.map((f) => f.level);
  let level = dir > 0 ? Math.max(...levels) + 1 : Math.min(...levels) - 1;
  if (level === 0) level = dir;
  floors.push({ level, layer: new CellLayer(), vectors: [], notes: [], images: [], icons: [] });
  floors.sort((a, b) => b.level - a.level);
  switchFloor(level);
  renderFloors();
  save();
  toast(t("已添加{floor}", { floor: floorName(level) }));
}

let deleteArmed = 0;
function deleteCurrentFloor(btn: HTMLButtonElement) {
  if (floors.length <= 1) return;
  // 删除不可撤销：第一次点击变成“确认删除”，3 秒内再点一次才删除
  if (!deleteArmed) {
    btn.textContent = t("确认删除？");
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
  notes = next.notes;
  images = next.images;
  icons = next.icons;
  imgSel = null;
  renderFloors();
  afterEdit();
  toast(t("已删除{floor}", { floor: floorName(removed) }));
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
    const count = f.layer.size + (f.level === currentLevel ? vectors.length + notes.length + images.length + icons.length : f.vectors.length + f.notes.length + f.images.length + f.icons.length);
    const name = document.createElement("span");
    name.textContent = floorName(f.level);
    const meta = document.createElement("span");
    meta.className = "floor-meta";
    meta.textContent = f.level === currentLevel ? t("当前") : count ? String(count) : "";
    b.title = t("{floor}：{n} 个格子/图形（PageUp / PageDown 切换）", { floor: floorName(f.level), n: count });
    b.append(name, meta);
    b.addEventListener("click", () => switchFloor(f.level));
    floorList.appendChild(b);
  }
  // 楼层多时列表会滚动，保证当前层看得见
  floorList.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  const del = $("floor-del") as HTMLButtonElement;
  del.disabled = floors.length <= 1;
  if (!deleteArmed) { del.textContent = t("删除当前层"); del.classList.remove("danger"); }
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

function commit(change: Change, vectorsBefore?: VectorShape[], notesBefore?: Note[], imagesBefore?: RefImage[], iconsBefore?: MapIcon[]) {
  if (change.size === 0 && !vectorsBefore && !notesBefore && !imagesBefore && !iconsBefore) return;
  undoStack.push({ floor: currentLevel, cells: change, vectors: vectorsBefore, notes: notesBefore, images: imagesBefore, icons: iconsBefore });
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
  if (editing) closeNoteEditor();
  // 撤销/重做发生在别的楼层时，先切换过去，让用户看到变化
  if (e.floor !== currentLevel) switchFloor(e.floor);
  const inv: Entry = { floor: e.floor, cells: layer.apply(e.cells) };
  if (e.vectors) { inv.vectors = vectors; vectors = e.vectors; }
  if (e.notes) { inv.notes = notes; notes = e.notes; }
  if (e.images) { inv.images = images; images = e.images; imgSel = null; }
  if (e.icons) { inv.icons = icons; icons = e.icons; }
  return inv;
}
function afterEdit() {
  renderFloors();
  renderIconLegend();
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
  const notesBefore = notes.length ? notes : undefined;
  const imagesBefore = images.length ? images : undefined;
  const iconsBefore = icons.length ? icons : undefined;
  vectors = [];
  notes = [];
  images = [];
  icons = [];
  imgSel = null;
  commit(ch, before, notesBefore, imagesBefore, iconsBefore);
});

// ---------------- 本地保存（刷新页面不丢） ----------------
const STORAGE_KEY = "level-layout-designer.cells.v1";
const VECTOR_KEY = "level-layout-designer.vectors.v1";
const FLOORS_KEY = "level-layout-designer.floors.v1";
function floorData(): FloorData[] {
  syncFloor();
  return floors.map((f) => ({ level: f.level, cells: f.layer.toJSON(), vectors: f.vectors, notes: f.notes, images: f.images, icons: f.icons }));
}
function loadFloors(data: FloorData[], current: number) {
  floors = sanitizeFloors(data, (id) => imageStore.has(id)).map((f) => {
    const l = new CellLayer();
    l.load(f.cells);
    return { level: f.level, layer: l, vectors: f.vectors, notes: f.notes, images: f.images, icons: f.icons };
  });
  const cur = floors.find((f) => f.level === current) ?? floors.find((f) => f.level === 1) ?? floors[0];
  currentLevel = cur.level;
  layer = cur.layer;
  vectors = cur.vectors;
  notes = cur.notes;
  images = cur.images;
  icons = cur.icons;
  imgSel = null;
}
const IMAGES_KEY = "level-layout-designer.images.v1";
const CUSTOM_ICONS_KEY = "level-layout-designer.customicons.v1";
let saveTimer = 0;
/** 上次写入本地的图片 id 列表；图片数据很大，只在增删图片时才重写 */
let savedImageIds = "";
let imageSaveWarned = false;
/** 所有楼层和撤销记录里还在用的图片 id */
function usedImageIds(): Set<string> {
  const used = new Set<string>();
  for (const id of liveImageIds()) used.add(id);
  for (const r of images) used.add(r.id);
  for (const stack of [undoStack, redoStack]) for (const e of stack) {
    e.images?.forEach((r) => used.add(r.id));
    e.icons?.forEach((ic) => { const id = customImageId(ic.kind); if (id) used.add(id); });
  }
  return used;
}
/** 当前各楼层和图标库实际在用的图片（参考图 + 自定义图标） */
function liveImageIds(): Set<string> {
  syncFloor();
  const live = new Set<string>();
  for (const f of floors) {
    for (const r of f.images) live.add(r.id);
    for (const ic of f.icons) { const id = customImageId(ic.kind); if (id) live.add(id); }
  }
  for (const c of customIcons) live.add(c.id);
  return live;
}
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    localStorage.setItem(FLOORS_KEY, JSON.stringify({ current: currentLevel, floors: floorData() }));
  } catch { /* 存储不可用时忽略 */ }
  try { localStorage.setItem(CUSTOM_ICONS_KEY, JSON.stringify(customIcons)); } catch { /* 忽略 */ }
  // 本地只存当前各楼层和图标库用到的图片（撤销记录里的不存）
  const live = liveImageIds();
  const ids = [...live].sort().join(",");
  if (ids === savedImageIds) return;
  try {
    const obj: Record<string, string> = {};
    for (const id of live) obj[id] = imageStore.srcs.get(id)!;
    localStorage.setItem(IMAGES_KEY, JSON.stringify(obj));
    savedImageIds = ids;
  } catch {
    if (!imageSaveWarned) {
      imageSaveWarned = true;
      toast(t("参考图太大，浏览器存不下，刷新后可能会丢失。请记得导出工程文件保存。"), true);
    }
  }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 300);
}
// 关闭或刷新页面前立即保存，避免丢失最后一笔
window.addEventListener("pagehide", () => { if (saveTimer) flushSave(); });
try {
  const rawI = localStorage.getItem(IMAGES_KEY);
  const obj = rawI ? JSON.parse(rawI) : null;
  if (obj && typeof obj === "object") for (const [id, src] of Object.entries(obj)) if (typeof src === "string" && src.startsWith("data:image/")) imageStore.set(id, src);
  savedImageIds = Object.keys(obj ?? {}).sort().join(",");
  customIcons = sanitizeCustomIcons(JSON.parse(localStorage.getItem(CUSTOM_ICONS_KEY) || "[]"), (id) => imageStore.has(id));
} catch { /* 忽略 */ }
try {
  const rawF = localStorage.getItem(FLOORS_KEY);
  if (rawF) {
    const d = JSON.parse(rawF);
    loadFloors(d.floors, d.current);
  } else {
    // 旧版本只有一层：迁移为第一层
    const raw = localStorage.getItem(STORAGE_KEY);
    const rawV = localStorage.getItem(VECTOR_KEY);
    loadFloors([{ level: 1, cells: raw ? JSON.parse(raw) : [], vectors: rawV ? sanitizeVectors(JSON.parse(rawV)) : [], notes: [], images: [], icons: [] }], 1);
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
  if (tool === "icon") {
    canvas.style.cursor = "copy";
    if (hover && mode !== "pan" && !spaceDown) {
      const ic = iconAtCursor(hover.x, hover.y);
      const q = cam.worldToScreen(ic.x, ic.y);
      ctx.globalAlpha = 0.55;
      drawIconAt(ctx, ic.kind, q.x, q.y, ic.size * cam.zoom, false, (id) => imageStore.get(id));
      ctx.globalAlpha = 1;
    }
    return;
  }
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
  if (tool === "note") {
    canvas.style.cursor = noteDrag?.moved ? "grabbing" : hover && noteAt(hover.x, hover.y) ? "grab" : "copy";
    return;
  }
  if (tool === "select") {
    canvas.style.cursor = mode === "move" || noteDrag?.moved || (imgDrag?.moved && imgDrag.kind === "move") ? "grabbing"
      : imgDrag?.kind === "rotate" || (hover && imageHandleAt(hover.x, hover.y) === "rotate") ? "crosshair"
      : imgDrag?.kind === "resize" || (hover && imageHandleAt(hover.x, hover.y)) ? "nwse-resize"
      : hover && ((selection && inSelection(cam.screenToWorld(hover.x, hover.y))) || noteAt(hover.x, hover.y) || imageAt(hover.x, hover.y)) ? "move" : "default";
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
    // 参考图垫在所有格子下面
    for (const f of others) drawRefImages(ctx, cam, f.images, imageStore, floorAlpha(f.level));
    drawRefImages(ctx, cam, imgDrag ? images.map((r) => (r === imgDrag!.img ? draggedImage(imgDrag!) : r)) : images, imageStore);
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
    if (showRulers) drawRulers();
    for (const f of others) drawVectors(ctx, cam, f.vectors, floorAlpha(f.level));
    drawVectors(ctx, cam, hiddenVec ? vectors.filter((v) => !hiddenVec.has(v)) : vectors);
    drawDraft();
    const getImg = (id: string) => imageStore.get(id);
    for (const f of others) drawIcons(ctx, cam, f.icons, getImg, floorAlpha(f.level));
    const hiddenIcons = moveDrag && selection ? new Set(selection.icons) : undefined;
    drawIcons(ctx, cam, hiddenIcons ? icons.filter((ic) => !hiddenIcons.has(ic)) : icons, getImg, 1, selection ? new Set(selection.icons) : undefined);
    for (const f of others) drawNotes(ctx, cam, f.notes, floorAlpha(f.level));
    const hiddenNotes = moveDrag && selection ? new Set(selection.notes) : undefined;
    let shown = hiddenNotes ? notes.filter((n) => !hiddenNotes.has(n)) : notes;
    let hl = selection ? new Set(selection.notes) : undefined;
    if (noteDrag?.moved) {
      // 拖动中的备注画在新位置，并高亮
      const d = noteDrag;
      const ghost = draggedNote(d);
      shown = shown.map((n) => (n === d.note ? ghost : n));
      hl = new Set([...(hl ?? []), ghost]);
    }
    noteBoxes = drawNotes(ctx, cam, shown, 1, hl);
    drawSelection();
    drawImageSelection();
    drawHover();
    currentSwatch.style.background = currentColor;
    const hint = draftHint();
    hintEl.textContent = hint;
    hintEl.hidden = !hint;
    hudZoom.textContent = formatZoom(cam.zoom);
    const bk = activeLevel();
    hudBrush.textContent = t("笔刷: {size}", { size: `${formatCellSize(bk)} · ${formatLength(worldToMeters(levelStep(bk)))}` });
    hudFloor.textContent = floorName(currentLevel);
    syncImagePanel();
    selectPanel.hidden = !(selection && tool === "select" && !moveDrag);
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
  if (k === 0) return t("1 格");
  if (k > 0) {
    const n = Math.pow(SUBDIVISION, k);
    return t("{n}×{n} 格", { n: n < 1e6 ? String(n) : `10^${k}` });
  }
  const n = Math.pow(SUBDIVISION, -k);
  return t("1/{n} 格", { n: n < 1e6 ? String(n) : `10^${-k}` });
}

// ---- 现实尺寸：一格 = 多少米，以及坐标刻度开关 ----
const unitInput = $("unit-size") as HTMLInputElement;
const RULERS_KEY = "level-layout-designer.rulers.v1";
let showRulers = true;
try { showRulers = localStorage.getItem(RULERS_KEY) !== "0"; } catch { /* 忽略 */ }
const rulersInput = $("show-rulers") as HTMLInputElement;
rulersInput.checked = showRulers;
rulersInput.addEventListener("change", () => {
  showRulers = rulersInput.checked;
  try { localStorage.setItem(RULERS_KEY, showRulers ? "1" : "0"); } catch { /* 忽略 */ }
  rulersInput.blur();
  requestRender();
});
function syncUnitInput() {
  if (document.activeElement !== unitInput) unitInput.value = String(getMetersPerCell());
}
syncUnitInput();
unitInput.addEventListener("change", () => {
  const v = Number(unitInput.value);
  if (!(v > 0) || !isFinite(v)) { syncUnitInput(); toast(t("请输入大于 0 的数字"), true); return; }
  setMetersPerCell(v);
  syncUnitInput();
  updateCursorCell(hover?.x ?? width / 2, hover?.y ?? height / 2);
  requestRender();
  toast(t("比例已改为 {scale}", { scale: scaleText() }));
});
unitInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") unitInput.blur(); });

// ---- 鼠标位置 -> 格子坐标（放大细分后显示小数，精度跟随当前最细一级网格） ----
function updateCursorCell(sx: number, sy: number) {
  const w = cam.screenToWorld(sx, sy);
  // 精度跟随当前最细一级网格
  const prec = worldToMeters(levelStep(finestLevel(cam.zoom)));
  const f = (v: number) => formatLength(Math.round(worldToMeters(v) / prec) * prec, prec);
  hudCell.textContent = t("位置: {x}, {y}", { x: f(w.x), y: f(w.y) });
}

/**
 * 坐标刻度：沿着红色 X 轴和绿色 Y 轴标出米数，间隔随缩放自动取 1、2、5 × 10ⁿ 米，
 * 保证屏幕上每格刻度大约 90 像素以上。坐标轴移出屏幕时，刻度贴在屏幕边缘。
 */
function drawRulers() {
  const m = getMetersPerCell();
  // 世界坐标里刻度间隔：先换成米挑一个整齐的数，再换回世界坐标
  const minM = worldToMeters(90 / cam.zoom);
  const p10 = Math.pow(10, Math.floor(Math.log10(minM)));
  const stepM = [1, 2, 5, 10].map((f) => f * p10).find((v) => v >= minM - 1e-12)!;
  const step = (stepM / m) * CELL_SIZE;
  const o = cam.worldToScreen(0, 0);
  const ax = Math.min(Math.max(o.y, 64), height - 48);
  const ay = Math.min(Math.max(o.x, 8), width - 60);
  ctx.save();
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(30,33,39,0.9)";
  const label = (text: string, x: number, y: number, color: string) => {
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const decimalsFor = (n: number) => formatLength(n * stepM, stepM);
  // X 轴刻度
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const i0 = Math.ceil(cam.x / step), i1 = Math.floor((cam.x + width / cam.zoom) / step);
  for (let i = i0; i <= i1; i++) {
    if (i === 0) continue;
    const sx = (i * step - cam.x) * cam.zoom;
    ctx.fillStyle = "rgba(232,107,107,0.8)";
    ctx.fillRect(Math.round(sx), ax - 3, 1, 6);
    label(decimalsFor(i), sx, ax + 5, "rgba(240,170,170,0.95)");
  }
  // Y 轴刻度（向下为正，和格子坐标一致）
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const j0 = Math.ceil(cam.y / step), j1 = Math.floor((cam.y + height / cam.zoom) / step);
  for (let j = j0; j <= j1; j++) {
    if (j === 0) continue;
    const sy = (j * step - cam.y) * cam.zoom;
    ctx.fillStyle = "rgba(122,200,120,0.8)";
    ctx.fillRect(ay - 3, Math.round(sy), 6, 1);
    label(decimalsFor(j), ay + 6, sy, "rgba(170,225,165,0.95)");
  }
  if (o.x >= 0 && o.x <= width && o.y >= 0 && o.y <= height) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    label("0", o.x + 4, o.y + 4, "rgba(215,218,224,0.9)");
  }
  ctx.restore();
}

// ---------------- 指针：涂色 / 平移 / 双指缩放 ----------------
type Mode = "none" | "paint" | "draw" | "pan" | "pinch" | "marquee" | "move" | "noteDrag" | "imgDrag";
let mode: Mode = "none";
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;
let stroke: { change: Change; k: number; last: { x: number; y: number }; vectorsBefore?: VectorShape[]; iconsBefore?: MapIcon[] } | null = null;

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
    // 碰到的图标也删掉
    const keptIcons = icons.filter((ic) => !hitIcon(ic, w.x, w.y, tol / 2));
    if (keptIcons.length !== icons.length) {
      if (!stroke.iconsBefore) stroke.iconsBefore = icons;
      icons = keptIcons;
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
    commit(stroke.change, stroke.vectorsBefore, undefined, undefined, stroke.iconsBefore);
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
    let outline = rasterizeThickStroke(g.pts, g.closed, s, strokeWidth);
    const heads = g.closed ? [] : arrowHeads(g.pts, arrow, strokeWidth * s, 3 * s);
    if (heads.length) {
      // 格子模式的箭头：把箭头三角形填满格子
      const seen = new Set(outline.map((c) => c.i + "," + c.j));
      for (const tri of heads) for (const c of rasterizeFill(tri, s)) {
        const key = c.i + "," + c.j;
        if (!seen.has(key)) { seen.add(key); outline.push(c); }
      }
      outline = outline.slice();
    }
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
    ...(!isClosed(d) && arrow !== "none" ? { arrow } : {}),
  };
}

function commitDraft() {
  if (!draft) return;
  if (draft.smooth) {
    const before = vectors;
    vectors = [...vectors, draftVector(draft)];
    commit(new Map(), before);
  } else if (draft.tooMany) {
    toast(t("图形太大：超过 {n} 个格子。请缩小视图（笔刷格子变大）后再画。", { n: MAX_SHAPE_CELLS.toLocaleString() }), true);
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

/** 正在画的图形的现实尺寸：直线显示长度，其他显示宽 × 高（格子模式按占到的格子算） */
function draftSize(d: Draft): string {
  const s = levelStep(d.k);
  const prec = worldToMeters(s);
  const L = (w: number) => formatLength(worldToMeters(w), prec);
  if (d.kind === "line") {
    const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
    return t("长度 {len}", { len: L(d.smooth ? len : len + s) });
  }
  const box = shapeBox(d.a, d.b, d.constrain);
  const extra = d.smooth ? 0 : s;
  return t("宽 {w} × 高 {h}", { w: L(box.w + extra), h: L(box.h + extra) });
}

function draftHint(): string {
  if (tool === "arc") {
    if (!draft) return t("弧线：按下设起点，拖到终点松开");
    if (draft.phase === "pickEnd" || draft.phase === "drag") return t("弧线：选择终点");
    return t("弧线：移动鼠标调整弯曲，点击确认（Esc 取消）");
  }
  if (tool === "note") return t("备注：点击空白处添加，点击便签编辑；拖便签或拖圆点可分别移动，连线自动伸缩");
  if (tool === "select") return selection ? t("拖动选区移动 · 方向键微调 · R 旋转 · Delete 删除 · Esc 取消") : t("框选：拖出一个框选中内容（Ctrl+A 全选当前层）");
  if (tool === "shape") return draft ? `${t("松开生成；按住 Shift 画正图形")} · ${draftSize(draft)}` : t("图形：从一个角拖到对角");
  return "";
}

// ---------------- 备注 ----------------
/** 本帧当前楼层备注在屏幕上的位置，用于点击命中 */
let noteBoxes: NoteBox[] = [];
function noteAt(sx: number, sy: number): Note | null {
  return noteHit(sx, sy)?.note ?? null;
}
/** 命中的备注，以及点到的是钉子还是便签 */
function noteHit(sx: number, sy: number): { note: Note; pin: boolean } | null {
  for (let n = noteBoxes.length - 1; n >= 0; n--) {
    const b = noteBoxes[n];
    if (sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1) return { note: b.note, pin: b.pin };
  }
  return null;
}

const noteEditor = $("note-editor");
const noteText = $("note-text") as HTMLTextAreaElement;
let editing: { note: Note | null; at: Pt } | null = null;

/** 打开备注编辑框：note 为 null 表示在 at 处新建 */
function openNoteEditor(note: Note | null, at?: Pt) {
  const pos = note ? { x: note.x, y: note.y } : at!;
  editing = { note, at: pos };
  noteText.value = note?.text ?? "";
  ($("note-delete") as HTMLButtonElement).hidden = !note;
  const p = cam.worldToScreen(pos.x, pos.y);
  noteEditor.hidden = false;
  const w = noteEditor.offsetWidth, h = noteEditor.offsetHeight;
  noteEditor.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, p.x + 12))}px`;
  noteEditor.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, p.y + 12))}px`;
  noteText.focus();
  // 点击画布打开时，鼠标按下的默认行为会把焦点抢回页面，所以下一帧再聚焦一次
  setTimeout(() => { if (editing) noteText.focus(); }, 0);
  requestRender();
}

function closeNoteEditor() {
  editing = null;
  // 让快捷键（撤销等）立刻回到画布
  if (document.activeElement === noteText) noteText.blur();
  noteEditor.hidden = true;
  requestRender();
}

function saveNote() {
  if (!editing) return;
  const text = noteText.value.trim();
  const before = notes;
  if (editing.note) {
    if (!text) notes = notes.filter((n) => n !== editing!.note);
    else if (text !== editing.note.text) notes = notes.map((n) => (n === editing!.note ? { ...n, text } : n));
  } else if (text) {
    notes = [...notes, { x: editing.at.x, y: editing.at.y, text }];
  } else {
    // 新备注还没有内容：不要悄悄关掉，提示用户先写字
    toast(t("备注还是空的，先写点文字再保存"), true);
    noteText.focus();
    return;
  }
  if (notes !== before) commit(new Map(), undefined, before);
  closeNoteEditor();
}

function deleteNote() {
  if (!editing?.note) return closeNoteEditor();
  const before = notes;
  notes = notes.filter((n) => n !== editing!.note);
  commit(new Map(), undefined, before);
  closeNoteEditor();
}

$("note-save").addEventListener("click", saveNote);
$("note-cancel").addEventListener("click", closeNoteEditor);
$("note-delete").addEventListener("click", deleteNote);
noteText.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeNoteEditor(); }
  else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveNote(); }
});
// 任何工具下双击备注都可以编辑
canvas.addEventListener("dblclick", (e) => {
  const p = localPoint(e);
  const hit = noteAt(p.x, p.y);
  if (hit) openNoteEditor(hit);
  else if (tool === "select") {
    // 双击参考图可以选中它（包括已锁定的），用来解锁或调整
    const img = imageAt(p.x, p.y, true);
    if (img) { selection = null; imgSel = img; requestRender(); }
  }
});

// ---------------- 框选与移动 ----------------
/**
 * 框选工具：在当前楼层拖出一个框，格子中心在框内的格子、完全在框内的平滑图形被选中。
 * 在选区内按下拖动即可移动，移动距离对齐到格子（取选区中最粗一级格子的大小）。
 * Delete 删除、方向键微调、Esc 取消、Ctrl+A 全选当前层。
 */
interface Selection {
  cells: Cell[];
  vectors: VectorShape[];
  notes: Note[];
  icons: MapIcon[];
  box: { x0: number; y0: number; x1: number; y1: number };
  /** 移动的最小步长（世界坐标） */
  step: number;
  /** 旋转中心：第一次旋转时确定，之后连续旋转都绕同一点，转四次回到原位 */
  pivot?: Pt;
}
let selection: Selection | null = null;
let marquee: { a: Pt; b: Pt } | null = null;
let moveDrag: { start: Pt; dx: number; dy: number } | null = null;
/** 正在拖动的单条备注：按下时记录起点，移动超过几像素才算拖动，否则当作点击 */
/** pin = true：拖钉子（便签不动）；否则拖便签（钉子不动）。两者之间的连线自动伸缩 */
let noteDrag: { note: Note; pin: boolean; start: Pt; startScreen: Pt; dx: number; dy: number; moved: boolean } | null = null;

function beginNoteDrag(hit: { note: Note; pin: boolean }, p: Pt) {
  mode = "noteDrag";
  noteDrag = { note: hit.note, pin: hit.pin, start: cam.screenToWorld(p.x, p.y), startScreen: p, dx: 0, dy: 0, moved: false };
}

/** 按当前拖动量算出备注的新样子 */
function draggedNote(d: NonNullable<typeof noteDrag>): Note {
  return d.pin ? moveNotePin(d.note, d.dx, d.dy, cam.zoom) : moveNoteLabel(d.note, d.dx * cam.zoom, d.dy * cam.zoom);
}

/** 松开备注：拖动过就移动并记入撤销；只是点了一下则编辑（备注工具）或选中（框选工具） */
function endNoteDrag() {
  if (!noteDrag) return;
  const d = noteDrag;
  const { note, dx, dy, moved } = d;
  noteDrag = null;
  if (moved && (dx || dy)) {
    const before = notes;
    const movedNote = draggedNote(d);
    notes = notes.map((n) => (n === note ? movedNote : n));
    commit(new Map(), undefined, before);
    if (tool === "select") selection = makeSelection([], [], [movedNote]);
  } else if (tool === "note") {
    openNoteEditor(note);
  } else if (tool === "select") {
    selection = makeSelection([], [], [note]);
  }
}

function clearSelection() {
  if (selection || marquee) { selection = null; marquee = null; moveDrag = null; requestRender(); }
  if (imgSel) { imgSel = null; requestRender(); }
}

// ---------------- 参考图 ----------------
/** 拖动中的参考图预览：移动、拖右下角等比缩放，或拖上方圆点旋转 */
function draggedImage(d: NonNullable<typeof imgDrag>): RefImage {
  const r = d.img;
  if (d.kind === "move") return { ...r, x: r.x + d.dx, y: r.y + d.dy };
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (d.kind === "rotate") {
    const at = (p: Pt) => Math.atan2(p.y - cy, p.x - cx);
    const now = { x: d.start.x + d.dx, y: d.start.y + d.dy };
    let rot = (r.rot ?? 0) + ((at(now) - at(d.start)) * 180) / Math.PI;
    rot = d.shift ? Math.round(rot / 15) * 15 : Math.round(rot);
    return withRot(r, normAngle(rot));
  }
  // 缩放：在图片自身方向上算拖动距离，左上角保持不动
  const t = ((r.rot ?? 0) * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
  const lx = d.dx * cos + d.dy * sin, ly = -d.dx * sin + d.dy * cos;
  const ratio = r.h / r.w;
  const minW = 16 / cam.zoom;
  const w = Math.max(minW, r.w + lx, (r.h + ly) / ratio), h = w * ratio;
  const tl = refImageCorners(r)[0];
  const ncx = tl.x + (w / 2) * cos - (h / 2) * sin, ncy = tl.y + (w / 2) * sin + (h / 2) * cos;
  return { ...r, x: ncx - w / 2, y: ncy - h / 2, w, h };
}
function withRot(r: RefImage, rot: number): RefImage {
  const next: RefImage = { ...r, rot };
  if (!rot) delete next.rot;
  return next;
}
const HANDLE = 10;
const ROT_GAP = 26;
/** 选中参考图的手柄在屏幕上的位置：右下角缩放，上边中点外侧旋转 */
function imageHandles(img: RefImage) {
  const c = refImageCorners(img).map((p) => cam.worldToScreen(p.x, p.y));
  const ctr = cam.worldToScreen(img.x + img.w / 2, img.y + img.h / 2);
  const top = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
  const len = Math.hypot(top.x - ctr.x, top.y - ctr.y) || 1;
  const rot = { x: top.x + ((top.x - ctr.x) / len) * ROT_GAP, y: top.y + ((top.y - ctr.y) / len) * ROT_GAP };
  return { corners: c, resize: c[2], top, rot };
}
function imageHandleAt(sx: number, sy: number): "resize" | "rotate" | null {
  if (!imgSel || imgSel.locked) return null;
  const h = imageHandles(imgSel);
  if (Math.hypot(sx - h.rot.x, sy - h.rot.y) <= HANDLE) return "rotate";
  if (Math.abs(sx - h.resize.x) <= HANDLE && Math.abs(sy - h.resize.y) <= HANDLE) return "resize";
  return null;
}
/** 屏幕点下最上面的参考图；锁定的默认跳过 */
function imageAt(sx: number, sy: number, includeLocked = false): RefImage | null {
  const w = cam.screenToWorld(sx, sy);
  for (let n = images.length - 1; n >= 0; n--) {
    const img = images[n];
    if (img.locked && !includeLocked) continue;
    const l = refImageLocal(img, w.x, w.y);
    if (Math.abs(l.x) <= img.w / 2 && Math.abs(l.y) <= img.h / 2) return img;
  }
  return null;
}
function beginImageDrag(img: RefImage, kind: "move" | "resize" | "rotate", p: Pt) {
  mode = "imgDrag";
  selection = null;
  imgSel = img;
  imgDrag = { img, kind, start: cam.screenToWorld(p.x, p.y), startScreen: p, dx: 0, dy: 0, moved: false, shift: false };
}
function endImageDrag() {
  const d = imgDrag;
  imgDrag = null;
  if (!d || !d.moved || (!d.dx && !d.dy)) return;
  const next = draggedImage(d);
  if (next.x === d.img.x && next.y === d.img.y && next.w === d.img.w && (next.rot ?? 0) === (d.img.rot ?? 0)) { requestRender(); return; }
  replaceImage(d.img, next);
}
/** 替换一张参考图（记入撤销） */
function replaceImage(old: RefImage, next: RefImage) {
  const before = images;
  images = images.map((r) => (r === old ? next : r));
  if (imgSel === old) imgSel = next;
  commit(new Map(), undefined, undefined, before);
}
function deleteImage() {
  if (!imgSel) return;
  const before = images;
  const gone = imgSel;
  images = images.filter((r) => r !== gone);
  imgSel = null;
  commit(new Map(), undefined, undefined, before);
  toast(t("已删除参考图（可撤销）"));
}
function drawImageSelection() {
  if (!imgSel || tool !== "select") return;
  const shown = imgDrag?.moved ? draggedImage(imgDrag) : imgSel;
  const h = imageHandles(shown);
  ctx.save();
  ctx.strokeStyle = "#7aa2f7";
  ctx.lineWidth = 1.5;
  ctx.setLineDash(shown.locked ? [4, 4] : []);
  ctx.beginPath();
  h.corners.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  if (!shown.locked) {
    ctx.beginPath();
    ctx.moveTo(h.top.x, h.top.y);
    ctx.lineTo(h.rot.x, h.rot.y);
    ctx.stroke();
    ctx.fillStyle = "#7aa2f7";
    ctx.strokeStyle = "#1e2127";
    ctx.beginPath();
    ctx.arc(h.rot.x, h.rot.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7aa2f7";
    ctx.fillRect(h.resize.x - 5, h.resize.y - 5, 10, 10);
    ctx.strokeRect(h.resize.x - 5, h.resize.y - 5, 10, 10);
  }
  if (imgDrag?.moved && imgDrag.kind === "rotate") {
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillStyle = "#d7dae0";
    ctx.fillText(`${shown.rot ?? 0}°`, h.rot.x + 12, h.rot.y - 8);
  }
  ctx.restore();
}

/** 读入图片文件，放在屏幕 at 处（默认屏幕中央），约占屏幕的 60% */
async function importImageFile(file: Blob, at?: Pt) {
  let loaded;
  try {
    loaded = await loadImageFile(file);
  } catch {
    toast(t("无法读取这张图片，请换 PNG / JPG / WebP 格式试试。"), true);
    return;
  }
  const id = imageStore.add(loaded.src);
  const scale = Math.min((width * 0.6) / loaded.width, (height * 0.6) / loaded.height);
  const w = (loaded.width * scale) / cam.zoom, h = (loaded.height * scale) / cam.zoom;
  const c = cam.screenToWorld(at?.x ?? width / 2, at?.y ?? height / 2);
  const img: RefImage = { id, x: c.x - w / 2, y: c.y - h / 2, w, h, opacity: DEFAULT_OPACITY, locked: false };
  const before = images;
  images = [...images, img];
  commit(new Map(), undefined, undefined, before);
  setTool("select");
  imgSel = img;
  requestRender();
  toast(t("已导入参考图：拖动移动，拖右下角缩放；调好后勾选“锁定”，就能在上面画了"));
}

const imagePanel = $("image-options");
const selectPanel = $("select-options");
$("sel-rot-ccw").addEventListener("click", () => rotateSelection(-1));
$("sel-rot-cw").addEventListener("click", () => rotateSelection(1));
const imageOpacity = $("image-opacity") as HTMLInputElement;
const imageOpacityText = $("image-opacity-text");
const imageLock = $("image-lock") as HTMLInputElement;
/** 拖动透明度滑块时先实时预览，松手时整体记一步撤销 */
let opacityBefore: RefImage[] | null = null;
function syncImagePanel() {
  const show = !!imgSel && tool === "select";
  imagePanel.hidden = !show;
  if (!show || !imgSel) return;
  const pct = Math.round(imgSel.opacity * 100);
  if (document.activeElement !== imageOpacity) imageOpacity.value = String(pct);
  imageOpacityText.textContent = `${pct}%`;
  imageLock.checked = imgSel.locked;
  if (document.activeElement !== imageRot) imageRot.value = String(imgSel.rot ?? 0);
}
imageOpacity.addEventListener("input", () => {
  if (!imgSel) return;
  if (!opacityBefore) opacityBefore = images;
  const old = imgSel;
  const next = { ...old, opacity: clampOpacity(Number(imageOpacity.value) / 100) };
  images = images.map((r) => (r === old ? next : r));
  imgSel = next;
  requestRender();
});
imageOpacity.addEventListener("change", () => {
  if (opacityBefore) commit(new Map(), undefined, undefined, opacityBefore);
  opacityBefore = null;
  imageOpacity.blur();
});
imageLock.addEventListener("change", () => {
  if (!imgSel) return;
  const locked = imageLock.checked;
  replaceImage(imgSel, { ...imgSel, locked });
  imageLock.blur();
  if (locked) toast(t("已锁定：点击会穿透这张图。要再调整，用框选工具双击图片"));
});
$("image-delete").addEventListener("click", deleteImage);
const imageRot = $("image-rot") as HTMLInputElement;
function setImageRot(deg: number) {
  if (!imgSel || !isFinite(deg)) return;
  const rot = normAngle(Math.round(deg * 10) / 10);
  if (rot === (imgSel.rot ?? 0)) { syncImagePanel(); return; }
  replaceImage(imgSel, withRot(imgSel, rot));
}
imageRot.addEventListener("change", () => setImageRot(Number(imageRot.value)));
imageRot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") imageRot.blur(); });
$("image-rot-ccw").addEventListener("click", () => imgSel && setImageRot((imgSel.rot ?? 0) - 90));
$("image-rot-cw").addEventListener("click", () => imgSel && setImageRot((imgSel.rot ?? 0) + 90));
$("image-front").addEventListener("click", () => {
  if (!imgSel) return;
  const before = images;
  const cur = imgSel;
  images = [...images.filter((r) => r !== cur), cur];
  commit(new Map(), undefined, undefined, before);
});

const imageInput = $("file-image") as HTMLInputElement;
$("btn-image").addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  imageInput.value = "";
  if (file) void importImageFile(file);
});
// ---------------- 关卡图标 ----------------
const ICON_KIND_KEY = "level-layout-designer.iconkind.v1";
const ICON_SIZE_KEY = "level-layout-designer.iconsize.v1";
let iconKind = "stairs-up";
let iconSize = 2;
try {
  const k = localStorage.getItem(ICON_KIND_KEY);
  if (k && (isBuiltinIcon(k) || customIcons.some((c) => customKind(c.id) === k))) iconKind = k;
  iconSize = Math.max(1, Math.min(20, Math.round(Number(localStorage.getItem(ICON_SIZE_KEY)) || 2)));
} catch { /* 忽略 */ }

/** 图标的默认名字 */
const iconDefaultLabel = (kind: string) => {
  if (isBuiltinIcon(kind)) return t(ICONS[kind].label);
  return customIcons.find((c) => customKind(c.id) === kind)?.name ?? t("自定义图标");
};
/** 图标说明（用户可以在右侧“图标说明”里改成具体含义），没改过就用默认名字 */
const ICON_LABELS_KEY = "level-layout-designer.iconlabels.v1";
let iconLabels: Record<string, string> = {};
try { iconLabels = sanitizeIconLabels(JSON.parse(localStorage.getItem(ICON_LABELS_KEY) || "{}")); } catch { /* 忽略 */ }
const iconLabel = (kind: string) => iconLabels[kind] || iconDefaultLabel(kind);
function setIconLabel(kind: string, text: string) {
  const t = text.trim().slice(0, 60);
  if (!t || t === iconDefaultLabel(kind)) delete iconLabels[kind];
  else iconLabels[kind] = t;
  try { localStorage.setItem(ICON_LABELS_KEY, JSON.stringify(iconLabels)); } catch { /* 忽略 */ }
  renderIconPalette();
}

/** 右侧“图标说明”：列出所有楼层用到的图标，文字可以直接改 */
const iconLegend = $("icon-legend");
const iconLegendList = $("icon-legend-list");
let iconLegendSig = "";
function renderIconLegend(force = false) {
  syncFloor();
  const kinds: string[] = [];
  for (const f of floors) for (const ic of f.icons) if (!kinds.includes(ic.kind)) kinds.push(ic.kind);
  const sig = kinds.join("|") + "#" + kinds.map(iconLabel).join("|");
  if (!force && sig === iconLegendSig) return;
  // 正在输入时不要重建，免得打断
  if (!force && iconLegendList.contains(document.activeElement)) return;
  iconLegendSig = sig;
  iconLegend.hidden = !kinds.length;
  iconLegendList.replaceChildren();
  const dpr = window.devicePixelRatio || 1;
  for (const kind of kinds) {
    const row = document.createElement("div");
    row.className = "icon-legend-row";
    let pic: HTMLElement;
    const imgId = customImageId(kind);
    if (imgId) {
      const img = document.createElement("img");
      img.src = imageStore.srcs.get(imgId) ?? "";
      img.alt = "";
      pic = img;
    } else {
      const c = document.createElement("canvas");
      c.width = c.height = Math.round(20 * dpr);
      const g = c.getContext("2d")!;
      g.scale(dpr, dpr);
      drawIconAt(g, kind, 10, 10, 20);
      pic = c;
    }
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 60;
    input.value = iconLabel(kind);
    input.placeholder = iconDefaultLabel(kind);
    input.title = t("“{name}”图标在这个关卡里代表什么", { name: iconDefaultLabel(kind) });
    input.setAttribute("aria-label", t("{name} 图标的说明", { name: iconDefaultLabel(kind) }));
    input.addEventListener("change", () => { setIconLabel(kind, input.value); input.value = iconLabel(kind); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") input.blur(); });
    row.append(pic, input);
    iconLegendList.appendChild(row);
  }
}

/** 光标处要放的图标：大小按当前笔刷格子算；奇数格对齐格子中心，偶数格对齐格线交点 */
function iconAtCursor(sx: number, sy: number): MapIcon {
  const s = levelStep(brushLevel(cam.zoom));
  const w = cam.screenToWorld(sx, sy);
  const off = iconSize % 2 ? s / 2 : 0;
  const snap = (v: number) => Math.round((v - off) / s) * s + off;
  return { kind: iconKind, x: snap(w.x), y: snap(w.y), size: iconSize * s };
}

function placeIcon(sx: number, sy: number) {
  const ic = iconAtCursor(sx, sy);
  // 同一位置已有同样的图标就不重复放
  if (icons.some((o) => o.kind === ic.kind && o.x === ic.x && o.y === ic.y && o.size === ic.size)) return;
  const before = icons;
  icons = [...icons, ic];
  commit(new Map(), undefined, undefined, undefined, before);
}

const iconGrid = $("icon-grid");
const iconSizeInput = $("icon-size") as HTMLInputElement;
const iconRename = $("icon-rename") as HTMLInputElement;
function setIconKind(kind: string) {
  iconKind = kind;
  try { localStorage.setItem(ICON_KIND_KEY, kind); } catch { /* 忽略 */ }
  renderIconPalette();
  setTool("icon");
}
function setIconSize(n: number) {
  iconSize = Math.max(1, Math.min(20, Math.round(n) || 1));
  iconSizeInput.value = String(iconSize);
  try { localStorage.setItem(ICON_SIZE_KEY, String(iconSize)); } catch { /* 忽略 */ }
  requestRender();
}
function renderIconPalette() {
  iconGrid.replaceChildren();
  const dpr = window.devicePixelRatio || 1;
  const add = (kind: string, label: string, content: HTMLElement) => {
    const b = document.createElement("button");
    b.title = label;
    b.setAttribute("aria-label", label);
    b.setAttribute("aria-pressed", String(kind === iconKind));
    b.append(content);
    b.addEventListener("click", () => { setIconKind(kind); b.blur(); });
    iconGrid.appendChild(b);
  };
  for (const [kind, def] of Object.entries(ICONS)) {
    const c = document.createElement("canvas");
    c.width = c.height = Math.round(24 * dpr);
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    drawIconAt(g, kind, 12, 12, 24);
    add(kind, t(def.label), c);
  }
  for (const ci of customIcons) {
    const img = document.createElement("img");
    img.src = imageStore.srcs.get(ci.id) ?? "";
    img.alt = "";
    add(customKind(ci.id), ci.name, img);
  }
  $("icon-name").textContent = iconLabel(iconKind);
  const custom = customIcons.find((c) => customKind(c.id) === iconKind);
  $("icon-custom-row").hidden = !custom;
  if (custom && document.activeElement !== iconRename) iconRename.value = custom.name;
}
iconSizeInput.value = String(iconSize);
iconSizeInput.addEventListener("change", () => { setIconSize(Number(iconSizeInput.value)); iconSizeInput.blur(); });
iconSizeInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") iconSizeInput.blur(); });
$("icon-dec").addEventListener("click", () => setIconSize(iconSize - 1));
$("icon-inc").addEventListener("click", () => setIconSize(iconSize + 1));

// 自定义图标：导入、改名、移除
const iconFileInput = $("file-icon") as HTMLInputElement;
$("icon-import").addEventListener("click", () => iconFileInput.click());
iconFileInput.addEventListener("change", async () => {
  const files = [...(iconFileInput.files ?? [])];
  iconFileInput.value = "";
  let added = 0, last = "";
  for (const file of files) {
    try {
      const { src } = await loadImageFile(file, 256);
      const id = imageStore.add(src);
      if (!customIcons.some((c) => c.id === id)) {
        const name = (file.name || t("自定义图标")).replace(/\.[^.]+$/, "").slice(0, 40) || t("自定义图标");
        customIcons = [...customIcons, { id, name }];
      }
      last = customKind(id);
      added++;
    } catch { /* 跳过读不了的文件 */ }
  }
  if (!added) { toast(t("无法读取这些图片，请换 PNG / SVG / JPG / WebP 格式试试。"), true); return; }
  save();
  setIconKind(last);
  toast(t("已导入 {n} 个图标，点击画布放置；可以在下面改名字", { n: added }));
});
iconRename.addEventListener("change", () => {
  const id = customImageId(iconKind);
  const name = iconRename.value.trim().slice(0, 40);
  if (!id || !name) return;
  customIcons = customIcons.map((c) => (c.id === id ? { ...c, name } : c));
  save();
  renderIconPalette();
  renderIconLegend(true);
});
iconRename.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") iconRename.blur(); });
$("icon-remove").addEventListener("click", () => {
  const id = customImageId(iconKind);
  if (!id) return;
  const removed = customIcons.find((c) => c.id === id);
  customIcons = customIcons.filter((c) => c.id !== id);
  iconKind = "stairs-up";
  save();
  renderIconPalette();
  if (removed) toast(t("已从图标库移除「{name}」（画布上已放的保留）", { name: removed.name }));
});
renderIconPalette();

// 直接粘贴截图（Ctrl+V）
window.addEventListener("paste", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (!file) return;
  e.preventDefault();
  void importImageFile(file);
});

function makeSelection(cells: Cell[], vecs: VectorShape[], ns: Note[] = [], ics: MapIcon[] = []): Selection | null {
  if (!cells.length && !vecs.length && !ns.length && !ics.length) return null;
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
  for (const n of ns) {
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
  }
  for (const ic of ics) {
    const h = ic.size / 2;
    x0 = Math.min(x0, ic.x - h); y0 = Math.min(y0, ic.y - h); x1 = Math.max(x1, ic.x + h); y1 = Math.max(y1, ic.y + h);
  }
  return { cells, vectors: vecs, notes: ns, icons: ics, box: { x0, y0, x1, y1 }, step };
}

function selectInRect(a: Pt, b: Pt) {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const cells = layer.cellsInRect(x0, y0, x1, y1);
  const vecs = vectors.filter((v) => { const r = vectorBounds(v); return r.x0 >= x0 && r.y0 >= y0 && r.x1 <= x1 && r.y1 <= y1; });
  const ns = notes.filter((n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1);
  const ics = icons.filter((ic) => ic.x >= x0 && ic.x <= x1 && ic.y >= y0 && ic.y <= y1);
  selection = makeSelection(cells, vecs, ns, ics);
}

function selectAll() {
  setTool("select");
  selection = makeSelection(layer.cellsInRect(-Infinity, -Infinity, Infinity, Infinity), [...vectors], [...notes], [...icons]);
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
  let notesBefore: Note[] | undefined;
  let movedNotes = selection.notes;
  if (selection.notes.length) {
    notesBefore = notes;
    const set = new Set(selection.notes);
    movedNotes = selection.notes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
    notes = notes.filter((n) => !set.has(n)).concat(movedNotes);
  }
  let iconsBefore: MapIcon[] | undefined;
  let movedIcons = selection.icons;
  if (selection.icons.length) {
    iconsBefore = icons;
    const set = new Set(selection.icons);
    movedIcons = selection.icons.map((ic) => ({ ...ic, x: ic.x + dx, y: ic.y + dy }));
    icons = icons.filter((ic) => !set.has(ic)).concat(movedIcons);
  }
  commit(change, before, notesBefore, undefined, iconsBefore);
  const pivot = selection.pivot;
  selection = makeSelection(moved, movedVecs, movedNotes, movedIcons);
  if (selection) selection.step = Math.max(selection.step, levelStep(brushLevel(cam.zoom)));
  if (selection && pivot) selection.pivot = { x: pivot.x + dx, y: pivot.y + dy };
  requestRender();
}

/**
 * 把选区绕中心顺时针旋转 q 个 90°（q 为负则逆时针），可撤销。
 * 旋转中心对齐到格子，保证格子转完仍然落在格子上；图标和备注文字保持正向，只转位置。
 */
function rotateSelection(q: number) {
  if (!selection) return;
  const s = selection.step;
  const b = selection.box;
  const half = s / 2;
  let cx: number, cy: number;
  const onGrid = (p: Pt) => [p.x / half, p.y / half, (p.x + p.y) / s].every((v) => Math.abs(v - Math.round(v)) < 1e-6);
  if (selection.pivot && onGrid(selection.pivot)) ({ x: cx, y: cy } = selection.pivot);
  else {
    cx = Math.round((b.x0 + b.x1) / 2 / half) * half;
    cy = Math.round((b.y0 + b.y1) / 2 / half) * half;
    // 中心坐标之和必须是格子大小的整数倍，否则转完的格子会错开半格
    const k = (cx + cy) / s;
    if (Math.abs(k - Math.round(k)) > 1e-6) cy += half;
  }
  const R = (p: Pt) => rotQuarter(p, cx, cy, q);
  const change: Change = new Map();
  for (const c of selection.cells) layer.remove(c.k, c.i, c.j, change);
  const rotated = selection.cells.map((c) => {
    const sc = levelStep(c.k);
    const m = R({ x: (c.i + 0.5) * sc, y: (c.j + 0.5) * sc });
    return { ...c, i: Math.round(m.x / sc - 0.5), j: Math.round(m.y / sc - 0.5) };
  });
  for (const c of rotated) layer.paint(c.k, c.i, c.j, c.color, change);
  let before: VectorShape[] | undefined;
  let vecs = selection.vectors;
  if (vecs.length) {
    before = vectors;
    const set = new Set(vecs);
    vecs = vecs.map((v) => rotateVector(v, cx, cy, q));
    vectors = vectors.filter((v) => !set.has(v)).concat(vecs);
  }
  let notesBefore: Note[] | undefined;
  let ns = selection.notes;
  if (ns.length) {
    notesBefore = notes;
    const set = new Set(ns);
    ns = ns.map((n) => ({ ...n, ...R(n) }));
    notes = notes.filter((n) => !set.has(n)).concat(ns);
  }
  let iconsBefore: MapIcon[] | undefined;
  let ics = selection.icons;
  if (ics.length) {
    iconsBefore = icons;
    const set = new Set(ics);
    ics = ics.map((ic) => ({ ...ic, ...R(ic) }));
    icons = icons.filter((ic) => !set.has(ic)).concat(ics);
  }
  commit(change, before, notesBefore, undefined, iconsBefore);
  selection = makeSelection(rotated, vecs, ns, ics);
  if (selection) { selection.step = Math.max(s, selection.step); selection.pivot = { x: cx, y: cy }; }
  requestRender();
}

/** 把选中的格子和平滑图形改成 color（备注不变），可撤销 */
function recolorSelection(color: string, name: string) {
  if (!selection) return;
  const change: Change = new Map();
  const cells = selection.cells.map((c) => {
    if (c.color !== color) layer.paint(c.k, c.i, c.j, color, change);
    return { ...c, color };
  });
  let before: VectorShape[] | undefined;
  let vecs = selection.vectors;
  if (vecs.some((v) => v.color !== color)) {
    before = vectors;
    const map = new Map(vecs.map((v) => [v, { ...v, color }]));
    vectors = vectors.map((v) => map.get(v) ?? v);
    vecs = vecs.map((v) => map.get(v)!);
  }
  if (!change.size && !before) return;
  const step = selection.step;
  commit(change, before);
  const pivot = selection.pivot;
  selection = makeSelection(cells, vecs, selection.notes, selection.icons);
  if (selection) { selection.step = step; selection.pivot = pivot; }
  toast(t("已把选中的 {n} 项改成「{name}」", { n: cells.length + vecs.length, name: t(name) }));
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
  let notesBefore: Note[] | undefined;
  if (selection.notes.length) {
    notesBefore = notes;
    const set = new Set(selection.notes);
    notes = notes.filter((n) => !set.has(n));
  }
  let iconsBefore: MapIcon[] | undefined;
  if (selection.icons.length) {
    iconsBefore = icons;
    const set = new Set(selection.icons);
    icons = icons.filter((ic) => !set.has(ic));
  }
  commit(change, before, notesBefore, undefined, iconsBefore);
  const n = selection.cells.length + selection.vectors.length + selection.notes.length + selection.icons.length;
  selection = null;
  toast(t("已删除 {n} 项", { n }));
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
    drawIcons(ctx, cam, selection.icons.map((ic) => ({ ...ic, x: ic.x + dx, y: ic.y + dy })), (id) => imageStore.get(id));
    drawNotes(ctx, cam, selection.notes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })));
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
    noteDrag = null;
    imgDrag = null;
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
  } else if (e.button === 0 && tool === "icon") {
    placeIcon(p.x, p.y);
  } else if (e.button === 0 && tool === "note") {
    e.preventDefault();
    if (editing) closeNoteEditor();
    const hit = noteHit(p.x, p.y);
    if (hit) beginNoteDrag(hit, p);
    else openNoteEditor(null, cam.screenToWorld(p.x, p.y));
  } else if (e.button === 0 && tool === "select") {
    const w = cam.screenToWorld(p.x, p.y);
    const hitNote = noteHit(p.x, p.y);
    if (selection && inSelection(w)) {
      mode = "move";
      moveDrag = { start: w, dx: 0, dy: 0 };
    } else if (hitNote) {
      selection = null;
      imgSel = null;
      beginNoteDrag(hitNote, p);
    } else if (imageHandleAt(p.x, p.y)) {
      beginImageDrag(imgSel!, imageHandleAt(p.x, p.y)!, p);
    } else if (imageAt(p.x, p.y)) {
      beginImageDrag(imageAt(p.x, p.y)!, "move", p);
    } else {
      imgSel = null;
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
  } else if (mode === "imgDrag" && imgDrag) {
    if (Math.hypot(p.x - imgDrag.startScreen.x, p.y - imgDrag.startScreen.y) > 3) imgDrag.moved = true;
    if (imgDrag.moved) {
      const w = cam.screenToWorld(p.x, p.y);
      imgDrag.dx = w.x - imgDrag.start.x;
      imgDrag.dy = w.y - imgDrag.start.y;
      imgDrag.shift = e.shiftKey;
    }
  } else if (mode === "noteDrag" && noteDrag) {
    if (Math.hypot(p.x - noteDrag.startScreen.x, p.y - noteDrag.startScreen.y) > 3) noteDrag.moved = true;
    if (noteDrag.moved) {
      const w = cam.screenToWorld(p.x, p.y);
      noteDrag.dx = w.x - noteDrag.start.x;
      noteDrag.dy = w.y - noteDrag.start.y;
    }
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
    if (selection) toast(t("已选中 {n} 项：拖动移动，点右侧颜色换色，Delete 删除", { n: selection.cells.length + selection.vectors.length + selection.notes.length + selection.icons.length }));
  } else if (pointers.size === 0 && mode === "imgDrag") {
    endImageDrag();
  } else if (pointers.size === 0 && mode === "noteDrag") {
    endNoteDrag();
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
  // 导出窗口开着时不触发画布快捷键
  if (!exportDialog.hidden) return;
  // 备注编辑框开着时，按键都交给输入框，不触发工具快捷键
  if (editing) {
    if (e.key === "Escape") { e.preventDefault(); closeNoteEditor(); }
    else noteText.focus();
    return;
  }
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
  if (imgSel && tool === "select" && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); deleteImage(); return; }
  if (selection && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); deleteSelection(); return; }
  if ((e.key === "r" || e.key === "R") && tool === "select" && (selection || imgSel)) {
    e.preventDefault();
    const q = e.shiftKey ? -1 : 1;
    if (selection) rotateSelection(q);
    else if (imgSel && !imgSel.locked) setImageRot((imgSel.rot ?? 0) + 90 * q);
    return;
  }
  if (selection && e.key.startsWith("Arrow")) {
    e.preventDefault();
    const st = selection.step * (e.shiftKey ? 10 : 1);
    const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (d) moveSelection(d[0], d[1]);
    return;
  }
  if (e.key === "v" || e.key === "V") { setTool("select"); return; }
  if (e.key === "n" || e.key === "N") { setTool("note"); return; }
  if (e.key === "i" || e.key === "I") { setTool("icon"); return; }
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
    name: nameInput.value.trim() || t("未命名关卡"),
    exportedAt: new Date().toISOString(),
    grid: { cellSize: CELL_SIZE, subdivision: SUBDIVISION },
    view: { x: cam.x + width / 2 / cam.zoom, y: cam.y + height / 2 / cam.zoom, zoom: cam.zoom },
    legend: legend.map(({ name, color }) => ({ name, color })),
    currentFloor: currentLevel,
    floors: floorData(),
    images: Object.fromEntries([...liveImageIds()].filter((id) => imageStore.has(id)).map((id) => [id, imageStore.srcs.get(id)!])),
    customIcons,
    iconLabels,
    metersPerCell: getMetersPerCell(),
  };
}

type Saver = { save(r: { filename: string; data: string | Blob }): Promise<unknown> };
/**
 * 把文件交给用户保存：在 claude.ai 在线版里通过平台的下载能力（会弹确认）；
 * 本地运行时用普通的浏览器下载。返回是否成功。
 */
async function saveFile(filename: string, data: string | Blob, mime: string): Promise<boolean> {
  const claude = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (claude) {
    const downloads = (await claude.use("downloads").catch(() => null)) as Saver | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return true;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "declined") return false;
        if (code === "rate_limited") toast(t("上一个保存窗口还没关闭，请稍后再试。"), true);
        else if (code === "too_large") toast(t("文件太大，请降低清晰度或缩小范围后再试。"), true);
        else toast(t("这里无法保存文件，请在浏览器中打开本页面后再导出。"), true);
        return false;
      }
    }
  }
  const url = URL.createObjectURL(typeof data === "string" ? new Blob([data], { type: mime }) : data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

async function exportProject() {
  // 备注编辑框还开着、里面有字时，先把这条备注存下来，免得导出的文件里没有它
  if (editing && noteText.value.trim()) saveNote();
  const project = buildProject();
  const filename = projectFileName(project.name);
  const data = JSON.stringify(project, null, 2);
  if (await saveFile(filename, data, "application/json")) toast(t("已导出 {file}（{n} 层）", { file: filename, n: project.floors.length }));
}

// ---------------- 导出图片 ----------------
const EXPORT_KEY = "level-layout-designer.exportimage.v1";
let exportOpts: ExportOptions = { ...DEFAULT_EXPORT };
try { exportOpts = { ...DEFAULT_EXPORT, ...JSON.parse(localStorage.getItem(EXPORT_KEY) || "{}") }; } catch { /* 忽略 */ }
const exportDialog = $("export-dialog");
const expSel = (id: string) => $(id) as HTMLSelectElement;
const expChk = (id: string) => $(id) as HTMLInputElement;
function readExportForm(): ExportOptions {
  return {
    floors: expSel("exp-floors").value as ExportOptions["floors"],
    area: expSel("exp-area").value as ExportOptions["area"],
    cellPx: Number(expSel("exp-cellpx").value) || 32,
    theme: expSel("exp-theme").value as ExportOptions["theme"],
    grid: expChk("exp-grid").checked,
    notes: expChk("exp-notes").checked,
    refImages: expChk("exp-refimages").checked,
    usedOnly: expChk("exp-usedonly").checked,
    sameArea: expChk("exp-samearea").checked,
  };
}
function updateExportSummary() {
  const o = readExportForm();
  syncFloor();
  const n = o.floors === "current" ? 1 : floors.length;
  expChk("exp-samearea").disabled = o.floors === "current" || o.area === "view";
  $("export-summary").textContent =
    o.floors === "current" ? t("将导出「{floor}」一张 PNG。", { floor: floorName(currentLevel) })
    : o.floors === "each" ? t("将导出 {n} 张 PNG（每层一张），打包成一个 ZIP。", { n })
    : t("将把 {n} 层从上到下拼成一张 PNG，底部是合并的颜色和图标说明。", { n });
}
function openExportDialog() {
  if (editing) closeNoteEditor();
  const o = exportOpts;
  expSel("exp-floors").value = floors.length > 1 ? o.floors : "current";
  expSel("exp-area").value = o.area;
  expSel("exp-cellpx").value = String(o.cellPx);
  expSel("exp-theme").value = o.theme;
  expChk("exp-grid").checked = o.grid;
  expChk("exp-notes").checked = o.notes;
  expChk("exp-refimages").checked = o.refImages;
  expChk("exp-usedonly").checked = o.usedOnly;
  expChk("exp-samearea").checked = o.sameArea;
  updateExportSummary();
  exportDialog.hidden = false;
  expSel("exp-floors").focus();
}
function closeExportDialog() { exportDialog.hidden = true; }
$("export-form").addEventListener("change", updateExportSummary);
$("export-cancel").addEventListener("click", closeExportDialog);
exportDialog.addEventListener("pointerdown", (e) => { if (e.target === exportDialog) closeExportDialog(); });
exportDialog.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeExportDialog(); } });
$("btn-export-image").addEventListener("click", openExportDialog);
$("export-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const opts = readExportForm();
  exportOpts = opts;
  try { localStorage.setItem(EXPORT_KEY, JSON.stringify(opts)); } catch { /* 忽略 */ }
  const go = $("export-go") as HTMLButtonElement;
  go.disabled = true;
  go.textContent = t("正在生成…");
  try {
    syncFloor();
    const list = opts.floors === "current" ? floors.filter((f) => f.level === currentLevel) : floors;
    // 导出全部楼层时跳过空楼层（全空就照常导出）
    const nonEmpty = list.filter((f) => f.layer.size || f.vectors.length || f.notes.length || f.icons.length || (opts.refImages && f.images.length));
    const chosen = opts.floors === "current" || !nonEmpty.length ? list : nonEmpty;
    const v0 = cam.screenToWorld(0, 0), v1 = cam.screenToWorld(width, height);
    const title = nameInput.value.trim() || t("未命名关卡");
    const { images: out, downscaled } = await renderExport({
      floors: chosen.map((f) => ({ level: f.level, name: floorName(f.level), layer: f.layer, vectors: f.vectors, notes: f.notes, images: f.images, icons: f.icons })),
      legend: legend.map(({ name, color }) => ({ name: t(name), color })),
      iconLabel,
      store: imageStore,
      title,
      view: { x0: v0.x, y0: v0.y, x1: v1.x, y1: v1.y },
    }, opts);
    const base = projectFileName(title).replace(/\.json$/, "");
    let ok: boolean;
    if (out.length === 1) {
      const name = opts.floors === "stack" ? `${base}-${t("全部楼层")}.png` : `${base}-${out[0].name}.png`;
      ok = await saveFile(name, await canvasToPng(out[0].canvas), "image/png");
    } else {
      const files = await Promise.all(out.map(async (img, n) => ({
        name: `${String(n + 1).padStart(2, "0")}-${base}-${img.name}.png`,
        data: new Uint8Array(await (await canvasToPng(img.canvas)).arrayBuffer()),
      })));
      ok = await saveFile(`${base}-${t("楼层图片")}.zip`, makeZip(files), "application/zip");
    }
    if (ok) {
      closeExportDialog();
      const skipped = list.length - chosen.length;
      toast((out.length > 1 ? t("已导出 {n} 张图片", { n: out.length }) : t("已导出图片")) + (skipped > 0 ? t("（跳过 {n} 个空楼层）", { n: skipped }) : "") + (downscaled ? t("。内容太大，已自动降低清晰度") : ""));
    }
  } catch (err) {
    toast(t("导出图片失败：{msg}", { msg: (err as Error).message }), true);
  } finally {
    go.disabled = false;
    go.textContent = t("导出");
  }
});

function loadProject(p: ProjectFile) {
  endStroke();
  cancelDraft();
  clearSelection();
  for (const [id, src] of Object.entries(p.images)) imageStore.set(id, src);
  // 导入的自定义图标合并进图标库
  for (const ci of p.customIcons) if (!customIcons.some((c) => c.id === ci.id)) customIcons = [...customIcons, ci];
  iconLabels = { ...iconLabels, ...p.iconLabels };
  try { localStorage.setItem(ICON_LABELS_KEY, JSON.stringify(iconLabels)); } catch { /* 忽略 */ }
  renderIconPalette();
  loadFloors(p.floors, p.currentFloor);
  renderFloors();
  if (p.legend.length) {
    legend = p.legend.map((e) => ({ ...e, id: nextId++ }));
    saveLegend();
    renderLegend();
    selectEntry(legend[0].id);
  }
  nameInput.value = p.name || t("未命名关卡");
  try { localStorage.setItem(NAME_KEY, nameInput.value); } catch { /* 忽略 */ }
  setMetersPerCell(p.metersPerCell ?? DEFAULT_METERS_PER_CELL);
  syncUnitInput();
  cam.zoom = Math.min(1e9, Math.max(1e-6, p.view.zoom));
  cam.centerOn(p.view.x, p.view.y, width / 2, height / 2);
  // 导入的是另一个工程，旧的撤销记录不再适用
  undoStack.length = 0;
  redoStack.length = 0;
  imageStore.prune(usedImageIds());
  afterEdit();
  toast(t("已导入「{name}」（{n} 层）", { name: nameInput.value, n: p.floors.length }));
}

const fileInput = $("file-import") as HTMLInputElement;
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    loadProject(parseProject(await file.text()));
  } catch (err) {
    toast(t("导入失败：{msg}", { msg: (err as Error).message }), true);
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
  if (file.type.startsWith("image/")) { void importImageFile(file, localPoint(e)); return; }
  try { loadProject(parseProject(await file.text())); } catch (err) { toast(t("导入失败：{msg}", { msg: (err as Error).message }), true); }
});
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "s" || e.key === "S") {
    e.preventDefault();
    if (e.shiftKey) openExportDialog();
    else void exportProject();
  }
  else if (e.key === "o" || e.key === "O") { e.preventDefault(); fileInput.click(); }
});

// ---------------- 中英文切换 ----------------
const langBtn = $("btn-lang");
function applyLanguage() {
  const l = getLang();
  // 默认工程名跟着语言换
  const wasDefault = ["未命名关卡", "Untitled level"].includes(nameInput.value.trim());
  setLang(l);
  if (wasDefault) { nameInput.value = t("未命名关卡"); try { localStorage.setItem(NAME_KEY, nameInput.value); } catch { /* 忽略 */ } }
  langBtn.textContent = l === "zh" ? "EN" : "中文";
  relabelOptions();
  renderLegend();
  renderFloors();
  renderIconPalette();
  renderIconLegend(true);
  $("legend-toggle").textContent = legendPanel.classList.contains("collapsed") ? t("展开") : t("收起");
  if (!exportDialog.hidden) updateExportSummary();
  updateCursorCell(hover?.x ?? width / 2, hover?.y ?? height / 2);
  requestRender();
}
langBtn.addEventListener("click", () => {
  setLang(getLang() === "zh" ? "en" : "zh");
  applyLanguage();
  toast(getLang() === "zh" ? "已切换到中文" : "Switched to English");
});
applyLanguage();

renderFloors();
setSmooth(smooth);
setTool("brush");
renderLegend();
selectEntry(selectedId);
afterEdit();
resize();
resetView();
requestAnimationFrame(frame);
