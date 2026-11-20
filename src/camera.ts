/** 二维相机：世界坐标 <-> 屏幕坐标（CSS 像素）。screen = (world - pos) * zoom */
export interface Vec2 { x: number; y: number }

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 40;

export class Camera {
  /** 屏幕左上角对应的世界坐标 */
  x = 0;
  y = 0;
  zoom = 1;

  screenToWorld(sx: number, sy: number): Vec2 {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  /** 按屏幕像素平移 */
  panBy(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /** 以屏幕点 (sx, sy) 为中心缩放，使该点下的世界坐标保持不动 */
  zoomAt(sx: number, sy: number, newZoom: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
    const before = this.screenToWorld(sx, sy);
    this.zoom = z;
    this.x = before.x - sx / z;
    this.y = before.y - sy / z;
  }

  /** 让世界点 (wx, wy) 位于屏幕点 (sx, sy) */
  centerOn(wx: number, wy: number, sx: number, sy: number): void {
    this.x = wx - sx / this.zoom;
    this.y = wy - sy / this.zoom;
  }
}
