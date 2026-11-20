import { Camera } from "./camera";
import { CELL_SIZE, drawGrid, finestLevel } from "./grid";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const hudCell = document.getElementById("hud-cell")!;
const hudZoom = document.getElementById("hud-zoom")!;

const cam = new Camera();
let width = 0;
let height = 0;
let dirty = true;

function requestRender() {
  dirty = true;
}

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

function frame() {
  if (dirty) {
    dirty = false;
    drawGrid(ctx, cam, width, height);
    hudZoom.textContent = formatZoom(cam.zoom);
  }
  requestAnimationFrame(frame);
}

function formatZoom(z: number): string {
  const pct = z * 100;
  if (pct >= 1e5 || pct < 0.01) return `${pct.toExponential(1)}%`;
  return `${pct >= 10 ? Math.round(pct) : Number(pct.toPrecision(2))}%`;
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

// ---- 平移（指针拖拽）与双指缩放 ----
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;

function localPoint(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, localPoint(e));
  canvas.classList.add("panning");
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener("pointermove", (e) => {
  const p = localPoint(e);
  updateCursorCell(p.x, p.y);
  const prev = pointers.get(e.pointerId);
  if (!prev) return;

  if (pointers.size === 1) {
    cam.panBy(p.x - prev.x, p.y - prev.y);
  } else if (pointers.size === 2) {
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
  if (pointers.size < 2) pinchDist = 0;
  if (pointers.size === 0) canvas.classList.remove("panning");
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
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
    updateCursorCell(p.x, p.y);
    requestRender();
  },
  { passive: false },
);

// ---- 键盘与按钮 ----
function zoomCenter(factor: number) {
  cam.zoomAt(width / 2, height / 2, cam.zoom * factor);
  requestRender();
}
window.addEventListener("keydown", (e) => {
  if (e.key === "0" || e.key === "Home") resetView();
  else if (e.key === "+" || e.key === "=") zoomCenter(1.25);
  else if (e.key === "-" || e.key === "_") zoomCenter(0.8);
});
document.getElementById("btn-zoom-in")!.addEventListener("click", () => zoomCenter(1.25));
document.getElementById("btn-zoom-out")!.addEventListener("click", () => zoomCenter(0.8));
document.getElementById("btn-reset")!.addEventListener("click", resetView);

window.addEventListener("resize", () => {
  // 保持屏幕中心对应的世界点不变
  const c = cam.screenToWorld(width / 2, height / 2);
  resize();
  cam.centerOn(c.x, c.y, width / 2, height / 2);
});

resize();
resetView();
requestAnimationFrame(frame);
