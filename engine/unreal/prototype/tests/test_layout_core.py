import math
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import layout_core as lc  # noqa: E402

WALL, FLOOR = "#8b93a3", "#c9b48a"
LEGEND = [{"name": "墙体", "color": WALL}, {"name": "地面", "color": FLOOR}]


def project(cells=(), vectors=(), level=1, mpc=None, **extra):
    d = {"format": lc.FORMAT, "version": 4, "name": "t", "legend": LEGEND,
         "floors": [{"level": level, "cells": list(cells), "vectors": list(vectors)}]}
    if mpc is not None:
        d["metersPerCell"] = mpc
    d.update(extra)
    return lc.normalize_project(d)


class Units(unittest.TestCase):
    def test_one_cell_is_one_meter(self):
        p = lc.build_plan(project([{"k": 0, "i": 0, "j": 0, "color": WALL}]))
        (b,) = p.boxes
        self.assertEqual(b.role, "wall")
        self.assertEqual(b.size, (100.0, 100.0, 400.0))
        self.assertEqual(b.center, (50.0, 50.0, 200.0))

    def test_meters_per_cell(self):
        p = lc.build_plan(project([{"k": 0, "i": 1, "j": 0, "color": FLOOR}], mpc=2))
        (b,) = p.boxes
        self.assertEqual(b.size[:2], (200.0, 200.0))
        self.assertEqual(b.center[:2], (300.0, 100.0))
        self.assertAlmostEqual(b.center[2], -15.0)  # 30 cm 楼板，顶面在 0

    def test_fine_level(self):
        p = lc.build_plan(project([{"k": -1, "i": -1, "j": 0, "color": WALL}]))
        (b,) = p.boxes
        self.assertAlmostEqual(b.size[0], 10.0)
        self.assertAlmostEqual(b.center[0], -5.0)


class Floors(unittest.TestCase):
    def test_elevations(self):
        s = lc.Settings()
        pr = lc.normalize_project({"format": lc.FORMAT, "version": 4, "floors": [
            {"level": 2}, {"level": 1}, {"level": -1}, {"level": -2, "elevation": -7.5}]})
        self.assertEqual(lc.floor_elevations(pr, s), {2: 5.0, 1: 0.0, -1: -5.0, -2: -7.5})

    def test_floor_filter(self):
        pr = project([{"k": 0, "i": 0, "j": 0, "color": WALL}], level=2)
        self.assertEqual(lc.build_plan(pr, lc.Settings(floors=[1])).boxes, [])

    def test_v1_file(self):
        pr = lc.normalize_project({"format": lc.FORMAT, "version": 1, "legend": LEGEND,
                                   "cells": [{"k": 0, "i": 0, "j": 0, "color": WALL}]})
        self.assertEqual(len(lc.build_plan(pr).boxes), 1)

    def test_too_new(self):
        with self.assertRaises(lc.LayoutError):
            lc.normalize_project({"format": lc.FORMAT, "version": 99})

    def test_not_a_project(self):
        with self.assertRaises(lc.LayoutError):
            lc.normalize_project({"format": "other", "version": 1})


class Flatten(unittest.TestCase):
    def test_fine_over_coarse_splits(self):
        flat = lc.flatten_cells([{"k": 1, "i": 0, "j": 0, "color": FLOOR}, {"k": 0, "i": 3, "j": 4, "color": WALL}])
        self.assertEqual(len(flat), 100)
        self.assertEqual(flat[(0, 3, 4)], WALL)
        self.assertEqual(sum(1 for c in flat.values() if c == FLOOR), 99)

    def test_two_levels_down(self):
        flat = lc.flatten_cells([{"k": 1, "i": 0, "j": 0, "color": FLOOR}, {"k": -1, "i": 5, "j": 5, "color": WALL}])
        self.assertEqual(flat[(-1, 5, 5)], WALL)
        self.assertEqual(sum(1 for (k, _, _) in flat if k == 0), 99)
        self.assertEqual(sum(1 for (k, _, _) in flat if k == -1), 100)
        area = sum((10 ** k) ** 2 for (k, _, _) in flat)
        self.assertAlmostEqual(area, 100.0)

    def test_coarse_over_fine_replaces(self):
        flat = lc.flatten_cells([{"k": 0, "i": 3, "j": 4, "color": WALL}, {"k": 1, "i": 0, "j": 0, "color": FLOOR}])
        self.assertEqual(flat, {(1, 0, 0): FLOOR})

    def test_negative_indices(self):
        flat = lc.flatten_cells([{"k": 1, "i": -1, "j": -1, "color": FLOOR}, {"k": 0, "i": -1, "j": -10, "color": WALL}])
        self.assertEqual(flat[(0, -1, -10)], WALL)
        self.assertEqual(len(flat), 100)

    def test_later_wins(self):
        flat = lc.flatten_cells([{"k": 0, "i": 0, "j": 0, "color": WALL}, {"k": 0, "i": 0, "j": 0, "color": FLOOR}])
        self.assertEqual(flat, {(0, 0, 0): FLOOR})


class Greedy(unittest.TestCase):
    def test_block(self):
        cells = {(i, j) for i in range(3) for j in range(2)}
        self.assertEqual(lc.greedy_rects(cells), [(0, 0, 3, 2)])

    def test_l_shape_covers_all(self):
        cells = {(0, 0), (1, 0), (2, 0), (0, 1), (0, 2)}
        rects = lc.greedy_rects(cells)
        covered = {(i + x, j + y) for (i, j, w, h) in rects for x in range(w) for y in range(h)}
        self.assertEqual(covered, cells)
        self.assertEqual(len(rects), 2)


class Vectors(unittest.TestCase):
    def test_line(self):
        v = {"kind": "line", "a": {"x": 0, "y": 0}, "b": {"x": 0, "y": 320}, "color": WALL, "width": 32}
        (b,) = lc.build_plan(project(vectors=[v])).boxes
        self.assertAlmostEqual(b.yaw, 90.0)
        self.assertAlmostEqual(b.size[0], 1100.0)  # 10 m + 两端各半个线宽
        self.assertAlmostEqual(b.size[1], 100.0)
        self.assertAlmostEqual(b.center[1], 500.0)

    def test_arc_passes_through_bend(self):
        c = lc.arc_circle((0, 0), (320, 0), (160, 160))
        ux, uy, r, t0, sweep = c
        self.assertAlmostEqual(r, 160)
        mid = t0 + sweep / 2
        self.assertAlmostEqual(ux + r * math.cos(mid), 160, places=6)
        self.assertAlmostEqual(uy + r * math.sin(mid), 160, places=6)
        c2 = lc.arc_circle((0, 0), (320, 0), (160, -160))
        mid2 = c2[3] + c2[4] / 2
        self.assertAlmostEqual(c2[1] + c2[2] * math.sin(mid2), -160, places=6)

    def test_unfilled_rect_is_four_walls(self):
        v = {"kind": "rect", "a": {"x": 0, "y": 0}, "b": {"x": 320, "y": 160}, "color": WALL, "width": 8, "fill": False}
        self.assertEqual(len(lc.build_plan(project(vectors=[v])).boxes), 4)

    def test_filled_ellipse_skipped_with_warning(self):
        v = {"kind": "ellipse", "a": {"x": 0, "y": 0}, "b": {"x": 64, "y": 64}, "color": FLOOR, "width": 4, "fill": True}
        p = lc.build_plan(project(vectors=[v]))
        self.assertEqual(p.boxes, [])
        self.assertTrue(p.warnings)

    def test_rotated_triangle_box_matches(self):
        v = {"kind": "triangle", "a": {"x": 0, "y": 0}, "b": {"x": 100, "y": 200}, "rot": 1}
        pts, closed = lc.shape_outline(v, 10)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        self.assertAlmostEqual(min(xs), 0)
        self.assertAlmostEqual(max(xs), 100)
        self.assertAlmostEqual(min(ys), 0)
        self.assertAlmostEqual(max(ys), 200)


class Sample(unittest.TestCase):
    def test_sample_project(self):
        p = lc.build_plan(lc.load_project(os.path.join(HERE, "sample-project.json")))
        roles = {b.role for b in p.boxes}
        self.assertTrue({"wall", "floor", "water", "hazard"} <= roles)
        self.assertEqual(sorted(p.floor_z), [-1, 1, 2])
        kinds = {m.kind: m for m in p.markers}
        self.assertEqual(kinds["spawn"].actor, "player_start")
        self.assertEqual(kinds["chest"].label, "金钥匙宝箱")
        self.assertEqual(len(p.notes), 1)
        # 格子合并后盒子数量远小于格子数
        self.assertLess(len([b for b in p.boxes if b.source == "cell"]), 60)


class Version5(unittest.TestCase):
    def test_legend_role_and_height(self):
        pr = lc.normalize_project({"format": lc.FORMAT, "version": 5, "legend": [
            {"id": "low", "name": "矮墙", "color": "#111111", "role": "wall", "height": 1.2},
            {"id": "x", "name": "墙体", "color": "#222222", "role": "floor"}],
            "floors": [{"level": 1, "wallHeight": 3, "elevation": 2, "cells": [
                {"k": 0, "i": 0, "j": 0, "color": "#111111"}, {"k": 0, "i": 2, "j": 0, "color": "#222222"}]}]})
        boxes = {b.color: b for b in lc.build_plan(pr).boxes}
        low = boxes["#111111"]
        self.assertEqual(low.role, "wall")
        self.assertAlmostEqual(low.size[2], 120.0)
        self.assertAlmostEqual(low.center[2], 200.0 + 60.0)  # 标高 2 m
        self.assertEqual(boxes["#222222"].role, "floor")  # role 优先于名字

    def test_icon_rot(self):
        pr = lc.normalize_project({"format": lc.FORMAT, "version": 5, "floors": [{"level": 1, "icons": [
            {"kind": "spawn", "x": 0, "y": 0, "size": 32, "rot": 270}, {"kind": "chest", "x": 0, "y": 0, "size": 32}]}]})
        m = lc.build_plan(pr).markers
        self.assertEqual(m[0].yaw, 270.0)
        self.assertEqual(m[1].yaw, 0.0)


if __name__ == "__main__":
    unittest.main()
