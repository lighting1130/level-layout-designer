"""
关卡 Layout 工程文件 -> 白盒“搭建计划”。

这个文件不依赖 Unreal，可以用普通 Python 3 运行和测试。
UE 里的脚本（import_layout.py）只负责把这里算出来的计划摆进关卡。

坐标约定：
- 网页世界坐标：基础格子边长 32，x 向右、y 向下。
- UE：厘米，X/Y 直接对应网页 x/y（UE 是左手坐标系，顶视图下 X 向右、Y 向下），Z 向上。
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field

FORMAT = "level-layout-designer"
MAX_VERSION = 5  # 能读到的最高版本；v5 的新字段（legend role、楼层标高）都是可选的
CELL_SIZE = 32  # 网页里基础格子的世界单位边长
SUBDIVISION = 10

# ---------- 默认参数（第三人称动作 RPG） ----------

@dataclass
class Settings:
    wall_height_m: float = 4.0
    floor_height_m: float = 5.0  # 每层之间的高度（没有标高时使用）
    floor_thickness_m: float = 0.3
    liquid_depth_m: float = 0.1  # 水域/伤害区：比地面低一点的薄板
    marker_size_m: float = 0.6
    arc_segment_m: float = 1.0  # 弧线和椭圆细分后每段的大致长度
    floors: list[int] | None = None  # 只导入这些楼层，None = 全部


# legend 名称 -> 角色。v5 文件可以直接在 legend 里写 role。
DEFAULT_ROLES = {
    "墙体": "wall", "墙": "wall", "wall": "wall", "walls": "wall",
    "地面": "floor", "草地": "floor", "floor": "floor", "ground": "floor", "grass": "floor",
    "水域": "water", "水": "water", "water": "water",
    "岩浆/伤害区": "hazard", "岩浆": "hazard", "伤害区": "hazard", "lava": "hazard", "hazard": "hazard",
    "lava/hazard": "hazard", "lava / hazard": "hazard", "damage": "hazard",
}
ROLES = {"wall", "floor", "water", "hazard", "marker", "none"}

# 图标 kind -> 生成什么
ICON_ACTORS = {
    "spawn": "player_start",
    "camera": "camera",
    "enemy": "enemy_spawn",
    "boss": "enemy_spawn",
}


# ---------- 计划里的元素 ----------

@dataclass
class Box:
    """一个摆放好的盒子：中心点、尺寸（厘米）、绕 Z 的 Yaw（度）"""
    role: str
    color: str
    floor: int
    center: tuple[float, float, float]
    size: tuple[float, float, float]
    yaw: float = 0.0
    source: str = "cell"  # cell / vector


@dataclass
class Marker:
    kind: str  # 图标 kind
    actor: str  # player_start / camera / enemy_spawn / placeholder
    label: str
    floor: int
    location: tuple[float, float, float]
    size_cm: float
    yaw: float = 0.0  # 朝向（v5 的 icons[].rot：顺时针角度，0 = +X，和 UE 的 Yaw 一致）


@dataclass
class NoteItem:
    text: str
    floor: int
    location: tuple[float, float, float]


@dataclass
class Plan:
    name: str
    meters_per_cell: float
    boxes: list[Box] = field(default_factory=list)
    markers: list[Marker] = field(default_factory=list)
    notes: list[NoteItem] = field(default_factory=list)
    floor_z: dict[int, float] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def bounds(self):
        """所有盒子的范围（厘米），用来放 NavMesh 范围等"""
        if not self.boxes:
            return None
        lo = [math.inf] * 3
        hi = [-math.inf] * 3
        for b in self.boxes:
            r = math.hypot(b.size[0], b.size[1]) / 2 if b.yaw else None
            for a in range(3):
                half = (r if (r is not None and a < 2) else b.size[a] / 2)
                lo[a] = min(lo[a], b.center[a] - half)
                hi[a] = max(hi[a], b.center[a] + half)
        return tuple(lo), tuple(hi)


# ---------- 读取 ----------

class LayoutError(Exception):
    pass


def load_project(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            raise LayoutError(f"文件不是有效的 JSON：{e}") from e
    return normalize_project(data)


def normalize_project(data: dict) -> dict:
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise LayoutError("这不是关卡 Layout 设计器的工程文件。")
    version = data.get("version")
    if not isinstance(version, (int, float)) or version > MAX_VERSION:
        raise LayoutError(f"工程文件版本 {version} 比导入脚本支持的新（最高 {MAX_VERSION}）。")
    floors = data.get("floors")
    if not isinstance(floors, list):  # 版本 1/2：顶层 cells / vectors，当作第一层
        floors = [{"level": 1, "cells": data.get("cells") or [], "vectors": data.get("vectors") or []}]
    mpc = data.get("metersPerCell")
    if not isinstance(mpc, (int, float)) or not mpc > 0:
        mpc = 1.0
    return {
        "name": data.get("name") or "Untitled",
        "metersPerCell": float(mpc),
        "legend": [e for e in data.get("legend") or [] if isinstance(e, dict) and isinstance(e.get("color"), str)],
        "iconLabels": data.get("iconLabels") or {},
        "customIcons": data.get("customIcons") or [],
        "floors": [f for f in floors if isinstance(f, dict) and isinstance(f.get("level"), int) and f["level"] != 0],
    }


# ---------- 格子压平 ----------

def _anc(k: int, i: int, j: int, k2: int) -> tuple[int, int, int]:
    """格子 (k,i,j) 在更粗一级 k2 (>= k) 上所在的格子"""
    f = SUBDIVISION ** (k2 - k)
    return (k2, i // f, j // f)


def flatten_cells(cells: list[dict]) -> dict[tuple[int, int, int], str]:
    """
    按绘制顺序处理格子，得到互不重叠、每格一种颜色的格子集合。
    后画的覆盖先画的；后画的细格子落在先画的粗格子里时，只把粗格子在需要的地方往下细分。
    """
    valid = [c for c in cells if all(isinstance(c.get(n), int) for n in ("k", "i", "j")) and isinstance(c.get("color"), str)]
    if not valid:
        return {}
    kmax = max(c["k"] for c in valid)
    out: dict[tuple[int, int, int], str] = {}
    # 祖先索引：祖先格子 key -> 现有的、落在它里面的更细格子 key
    desc: dict[tuple[int, int, int], set] = {}

    def add(key, color):
        out[key] = color
        k, i, j = key
        for k2 in range(k + 1, kmax + 1):
            desc.setdefault(_anc(k, i, j, k2), set()).add(key)

    def remove(key):
        del out[key]
        k, i, j = key
        for k2 in range(k + 1, kmax + 1):
            s = desc.get(_anc(k, i, j, k2))
            if s:
                s.discard(key)

    for c in valid:
        k, i, j, color = c["k"], c["i"], c["j"], c["color"].lower()
        key = (k, i, j)
        # 1. 覆盖掉被它完全盖住的格子（同级或更细）
        if key in out:
            remove(key)
        for d in list(desc.get(key, ())):
            remove(d)
        # 2. 如果它落在一个更粗的格子里，把那个粗格子拆开
        for k2 in range(k + 1, kmax + 1):
            p = _anc(k, i, j, k2)
            if p in out:
                pcolor = out[p]
                remove(p)
                # 从 p 往下逐级拆，直到 c 所在的那一级
                cur = p
                for lvl in range(k2 - 1, k - 1, -1):
                    target = _anc(k, i, j, lvl)
                    for di in range(SUBDIVISION):
                        for dj in range(SUBDIVISION):
                            ch = (lvl, cur[1] * SUBDIVISION + di, cur[2] * SUBDIVISION + dj)
                            if ch != target:
                                add(ch, pcolor)
                    cur = target
                break  # 现有集合互不重叠，最多只有一个祖先
        add(key, color)
    return out


# ---------- 贪心矩形合并 ----------

def greedy_rects(cells: set[tuple[int, int]]) -> list[tuple[int, int, int, int]]:
    """把同一级的格子合并成矩形，返回 (i0, j0, 宽, 高)，单位是这一级的格子"""
    left = set(cells)
    rects = []
    for (i, j) in sorted(cells, key=lambda p: (p[1], p[0])):
        if (i, j) not in left:
            continue
        w = 1
        while (i + w, j) in left:
            w += 1
        h = 1
        while all((i + x, j + h) in left for x in range(w)):
            h += 1
        for y in range(h):
            for x in range(w):
                left.discard((i + x, j + y))
        rects.append((i, j, w, h))
    return rects


# ---------- 搭建计划 ----------

def role_of(color: str, legend_by_color: dict) -> str:
    e = legend_by_color.get(color)
    if e is None:
        return "floor"
    r = e.get("role")
    if isinstance(r, str) and r in ROLES:
        return r
    name = str(e.get("name", "")).strip()
    return DEFAULT_ROLES.get(name, DEFAULT_ROLES.get(name.lower(), "marker"))


def floor_elevations(project: dict, s: Settings) -> dict[int, float]:
    """楼层 -> 地面标高（米）。v5 可以写 floors[].elevation；没有就按统一层高"""
    out = {}
    for f in project["floors"]:
        lv = f["level"]
        e = f.get("elevation")
        if isinstance(e, (int, float)):
            out[lv] = float(e)
        else:
            out[lv] = ((lv - 1) if lv > 0 else lv) * s.floor_height_m
    return out


def build_plan(project: dict, s: Settings | None = None) -> Plan:
    s = s or Settings()
    mpc = project["metersPerCell"]
    w2cm = mpc * 100.0 / CELL_SIZE  # 世界单位 -> 厘米
    plan = Plan(name=project["name"], meters_per_cell=mpc)
    legend_by_color = {}
    for e in project["legend"]:
        legend_by_color.setdefault(e["color"].lower(), e)
    elev = floor_elevations(project, s)
    unknown_colors = set()

    for f in project["floors"]:
        lv = f["level"]
        if s.floors is not None and lv not in s.floors:
            continue
        z0 = elev[lv] * 100.0
        plan.floor_z[lv] = z0
        wall_h = float(f.get("wallHeight") or s.wall_height_m) * 100.0

        def slab(role, color=None):
            """(底部 z, 高度) 厘米"""
            if role == "wall":
                h = (legend_by_color.get(color) or {}).get("height")  # v5：这种颜色自己的高度（矮墙等）
                return z0, (float(h) * 100.0 if isinstance(h, (int, float)) and h > 0 else wall_h)
            if role in ("water", "hazard"):
                t = s.floor_thickness_m * 100.0
                return z0 - s.liquid_depth_m * 100.0 - t, t
            t = s.floor_thickness_m * 100.0
            return z0 - t, t

        # 格子
        flat = flatten_cells(f.get("cells") or [])
        groups: dict[tuple[str, int], set] = {}
        for (k, i, j), color in flat.items():
            groups.setdefault((color, k), set()).add((i, j))
        for (color, k), cells in sorted(groups.items()):
            if color not in legend_by_color:
                unknown_colors.add(color)
            role = role_of(color, legend_by_color)
            if role in ("marker", "none"):
                continue
            step = CELL_SIZE * SUBDIVISION ** k * w2cm
            zb, h = slab(role, color)
            for (i0, j0, w, hh) in greedy_rects(cells):
                plan.boxes.append(Box(role, color, lv,
                                      ((i0 + w / 2) * step, (j0 + hh / 2) * step, zb + h / 2),
                                      (w * step, hh * step, h)))

        # 平滑图形
        skipped = 0
        for v in f.get("vectors") or []:
            color = str(v.get("color", "")).lower()
            role = role_of(color, legend_by_color)
            if role in ("marker", "none"):
                continue
            if color not in legend_by_color:
                unknown_colors.add(color)
            zb, h = slab(role, color)
            boxes = vector_boxes(v, w2cm, s)
            if boxes is None:
                skipped += 1
                continue
            for (cx, cy, length, width, yaw) in boxes:
                plan.boxes.append(Box(role, color, lv, (cx, cy, zb + h / 2), (length, width, h), yaw, "vector"))
        if skipped:
            plan.warnings.append(f"{floor_label(lv)}：{skipped} 个填充的平滑图形（非矩形）原型暂不支持，已跳过（第 2 阶段做）。")

        # 图标
        labels = project.get("iconLabels") or {}
        custom = {c.get("id"): c.get("name") for c in project.get("customIcons") or [] if isinstance(c, dict)}
        for ic in f.get("icons") or []:
            kind = ic.get("kind")
            if not isinstance(kind, str) or not all(isinstance(ic.get(n), (int, float)) for n in ("x", "y")):
                continue
            label = labels.get(kind) or (custom.get(kind[2:]) if kind.startswith("u:") else None) or kind
            plan.markers.append(Marker(kind, ICON_ACTORS.get(kind, "placeholder"), str(label), lv,
                                       (ic["x"] * w2cm, ic["y"] * w2cm, z0),
                                       float(ic.get("size") or CELL_SIZE) * w2cm,
                                       float(ic["rot"]) % 360 if isinstance(ic.get("rot"), (int, float)) else 0.0))

        # 备注
        for n in f.get("notes") or []:
            if isinstance(n.get("text"), str) and all(isinstance(n.get(a), (int, float)) for a in ("x", "y")):
                plan.notes.append(NoteItem(n["text"], lv, (n["x"] * w2cm, n["y"] * w2cm, z0 + 50.0)))

    if unknown_colors:
        plan.warnings.append("这些颜色不在颜色说明里，按地面处理：" + "、".join(sorted(unknown_colors)))
    return plan


def floor_label(level: int) -> str:
    return f"B{-level}" if level < 0 else f"{level}F"


# ---------- 平滑图形 -> 盒子 ----------

def _seg_boxes(pts, closed, width, w2cm):
    out = []
    segs = list(zip(pts, pts[1:] + pts[:1])) if closed else list(zip(pts, pts[1:]))
    for (a, b) in segs:
        dx, dy = (b[0] - a[0]) * w2cm, (b[1] - a[1]) * w2cm
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        # 线段两端各延长半个线宽，拐角处不留缝（和网页圆头线接近）
        out.append(((a[0] + b[0]) / 2 * w2cm, (a[1] + b[1]) / 2 * w2cm, length + width * w2cm,
                    width * w2cm, math.degrees(math.atan2(dy, dx))))
    return out


def _shape_box(a, b, constrain):
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    w, h = abs(b[0] - a[0]), abs(b[1] - a[1])
    if constrain:
        m = max(w, h)
        if b[0] < a[0]:
            x0 = a[0] - m
        if b[1] < a[1]:
            y0 = a[1] - m
        w = h = m
    return x0, y0, w, h


def _rotate_pts(pts, rot, cx, cy):
    """绕中心顺时针转 rot 个 90°（画布 y 向下，顺时针：(x,y) -> (-y,x)）"""
    out = []
    for (x, y) in pts:
        dx, dy = x - cx, y - cy
        for _ in range(rot % 4):
            dx, dy = -dy, dx
        out.append((cx + dx, cy + dy))
    return out


def shape_outline(v: dict, seg_world: float):
    """返回 (点列表, 是否闭合)，世界坐标。与网页 shapes.ts 的 shapePolygon 一致"""
    kind = v.get("kind")
    a = (v["a"]["x"], v["a"]["y"])
    b = (v["b"]["x"], v["b"]["y"])
    if kind == "line":
        if v.get("constrain"):
            dx, dy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(dx, dy)
            ang = round(math.atan2(dy, dx) / (math.pi / 4)) * (math.pi / 4)
            b = (a[0] + ln * math.cos(ang), a[1] + ln * math.sin(ang))
        return [a, b], False
    if kind == "arc":
        bend = v.get("bend")
        c = arc_circle(a, b, (bend["x"], bend["y"])) if bend else None
        if not c:
            return [a, b], False
        ux, uy, r, t0, sweep = c
        n = max(2, math.ceil(abs(sweep) * r / seg_world))
        return [(ux + r * math.cos(t0 + sweep * m / n), uy + r * math.sin(t0 + sweep * m / n)) for m in range(n + 1)], False
    rot = v.get("rot") or 0
    if rot % 2 == 1:
        # a、b 是旋转后的外接框；先换回旋转前的框（宽高互换），生成后再转回来
        cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        hw, hh = abs(b[0] - a[0]) / 2, abs(b[1] - a[1]) / 2
        a, b = (cx - hh, cy - hw), (cx + hh, cy + hw)
    x0, y0, w, h = _shape_box(a, b, bool(v.get("constrain")))
    cx, cy = x0 + w / 2, y0 + h / 2
    if kind == "rect":
        pts = [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h)]
    elif kind == "triangle":
        pts = [(cx, y0), (x0 + w, y0 + h), (x0, y0 + h)]
    elif kind == "diamond":
        pts = [(cx, y0), (x0 + w, cy), (cx, y0 + h), (x0, cy)]
    elif kind == "hexagon":
        pts = [(cx + w / 2 * math.cos(math.pi / 3 * n), cy + h / 2 * math.sin(math.pi / 3 * n)) for n in range(6)]
    elif kind == "polygon":
        n = max(3, min(64, int(v.get("sides") or 5)))
        pts = [(cx + w / 2 * math.cos(-math.pi / 2 + 2 * math.pi * m / n), cy + h / 2 * math.sin(-math.pi / 2 + 2 * math.pi * m / n)) for m in range(n)]
    elif kind == "ellipse":
        per = math.pi * (w + h) / 2
        n = max(12, math.ceil(per / seg_world))
        pts = [(cx + w / 2 * math.cos(2 * math.pi * m / n), cy + h / 2 * math.sin(2 * math.pi * m / n)) for m in range(n)]
        return pts, True  # 椭圆不旋转
    else:
        return None, False
    if rot:
        pts = _rotate_pts(pts, rot, cx, cy)
    return pts, True


def arc_circle(a, b, bend):
    """过起点 a、控制点 bend、终点 b 的圆；几乎共线时返回 None。与网页 arcCircle 一致"""
    (ax, ay), (bx, by), (cx, cy) = a, bend, b
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    chord = math.hypot(cx - ax, cy - ay)
    dist = abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay)) / (chord or 1)
    if abs(d) < 1e-12 or dist < chord * 0.01:
        return None
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    r = math.hypot(ax - ux, ay - uy)
    t0 = math.atan2(ay - uy, ax - ux)
    tm = math.atan2(by - uy, bx - ux)
    t1 = math.atan2(cy - uy, cx - ux)
    norm = lambda t: t % (2 * math.pi)
    ccw = norm(t1 - t0)  # 角度增加方向（画布 y 向下时是顺时针）
    sweep = ccw if norm(tm - t0) <= ccw else ccw - 2 * math.pi  # 选经过控制点的那一侧
    return ux, uy, r, t0, sweep


def vector_boxes(v: dict, w2cm: float, s: Settings):
    """平滑图形 -> [(中心x, 中心y, 长, 宽, yaw)]（厘米）。不支持的返回 None"""
    width = v.get("width") or 0
    if not isinstance(width, (int, float)) or width <= 0:
        return []
    seg_world = s.arc_segment_m * 100.0 / w2cm
    pts, closed = shape_outline(v, seg_world)
    if pts is None:
        return None
    if closed and v.get("fill"):
        if v.get("kind") == "rect":
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            # 线宽向外扩半个线宽（网页描边画在轮廓两侧）
            return [((x0 + x1) / 2 * w2cm, (y0 + y1) / 2 * w2cm, (x1 - x0 + width) * w2cm, (y1 - y0 + width) * w2cm, 0.0)]
        return None
    return _seg_boxes(pts, closed, width, w2cm)


def plan_to_dict(plan: Plan) -> dict:
    from dataclasses import asdict
    return asdict(plan)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("用法：python layout_core.py 工程文件.json   （打印搭建计划摘要）")
        sys.exit(1)
    p = build_plan(load_project(sys.argv[1]))
    by = {}
    for b in p.boxes:
        by[(b.floor, b.role)] = by.get((b.floor, b.role), 0) + 1
    print(f"工程：{p.name}，1 格 = {p.meters_per_cell} m")
    for (lv, role), n in sorted(by.items()):
        print(f"  {floor_label(lv)} {role}: {n} 个盒子")
    print(f"  图标 {len(p.markers)} 个，备注 {len(p.notes)} 条")
    for w in p.warnings:
        print("  警告：" + w)
