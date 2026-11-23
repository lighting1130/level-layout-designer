"""
第 0 阶段原型：在 Unreal Editor 5.8 里把关卡 Layout 工程文件（.json）生成成白盒。

用法（需要启用 Python Editor Script Plugin）：
  在 Output Log 底部把命令行切到 Cmd，输入：
    py "D:/path/to/engine/unreal/prototype/import_layout.py" "D:/path/to/第一关.json"
  不带工程文件路径时会弹出文件选择框。

可选参数：
  --wall 4        墙高（米）
  --floor 5       层高（米）
  --floors 1,-1   只导入这些楼层
  --keep          保留上次生成的白盒（默认先删除同名工程上次生成的 Actor）
  --backend auto|blockout|cube
                  墙和地面用什么摆：装了 Blockout Tools 插件时默认用它的 Blockout_Box，
                  否则用引擎 Cube

生成的东西：
  - 墙 / 地面 / 水域 / 伤害区：每个合并后的矩形一个 Actor，可以单独移动。
    启用了 Blockout Tools 插件时用它的 Blockout_Box（带网格材质，颜色取颜色说明），否则用引擎 Cube
  - spawn 图标 -> PlayerStart，camera -> CameraActor，其它图标 -> 带名字的小圆柱 + 文字
  - 备注 -> TextRenderActor（朝上，从顶视图能读）
  - 每种颜色一个材质实例，放在 /Game/LevelLayoutPrototype/<工程名>/
  - 全部放进 Outliner 文件夹 LevelLayout/<工程名>/<楼层>，带标签 LevelLayout:<工程名>
  - 整次导入是一个撤销步骤
"""
import math
import os
import re
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import layout_core  # noqa: E402

importlib.reload(layout_core)  # 在编辑器里改了脚本后重新运行能生效

CUBE = "/Engine/BasicShapes/Cube.Cube"  # 100 cm，中心在原点
CYLINDER = "/Engine/BasicShapes/Cylinder.Cylinder"
BASE_MATERIAL = "/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"  # 有 Color 参数
ASSET_ROOT = "/Game/LevelLayoutPrototype"

# Blockout Tools（Fab 上的商业插件，作者 Dmitry Karpukhin）。本仓库不包含它的任何文件，
# 只在用户自己装了并启用时按资产路径引用它的蓝图；没装时退回到引擎 Cube。
BLOCKOUT_BOX = "/BlockoutToolsPlugin/Blueprints/Blockout_Box.Blockout_Box_C"
BLOCKOUT_GRID_SIZE_CM = 100.0  # 白盒材质网格 = 网页里 1 格


def parse_args(argv):
    opts = {"path": None, "wall": None, "floor": None, "floors": None, "keep": False, "backend": "auto"}
    it = iter(argv)
    for a in it:
        if a == "--wall":
            opts["wall"] = float(next(it))
        elif a == "--floor":
            opts["floor"] = float(next(it))
        elif a == "--floors":
            opts["floors"] = [int(x) for x in next(it).split(",") if x.strip()]
        elif a == "--keep":
            opts["keep"] = True
        elif a == "--backend":
            opts["backend"] = next(it)
        elif not a.startswith("--"):
            opts["path"] = a
    return opts


def pick_file():
    try:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
        root.withdraw()
        path = filedialog.askopenfilename(title="选择关卡 Layout 工程文件", filetypes=[("工程文件", "*.json")])
        root.destroy()
        return path or None
    except Exception as e:  # 有些引擎自带的 Python 没有 tkinter
        unreal.log_warning(f"[LevelLayout] 无法打开文件选择框（{e}），请在命令里写上工程文件路径。")
        return None


def safe_name(name):
    return re.sub(r"[^0-9A-Za-z_\u4e00-\u9fff]+", "_", name).strip("_")[:60] or "Untitled"


def hex_to_linear(hexcolor):
    """#rrggbb（sRGB）-> 线性颜色"""
    def lin(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hexcolor[n:n + 2], 16) for n in (1, 3, 5))
    return unreal.LinearColor(r=lin(r), g=lin(g), b=lin(b), a=1.0)


class Importer:
    def __init__(self, plan, keep, backend="auto"):
        self.plan = plan
        self.keep = keep
        self.blockout = None if backend == "cube" else BlockoutBackend.load(self)
        if backend == "blockout" and self.blockout is None:
            raise RuntimeError("没有找到 Blockout Tools 插件，请在 Edit → Plugins 里启用它，或者去掉 --backend blockout。")
        self.name = safe_name(plan.name)
        self.tag = unreal.Name(f"LevelLayout:{self.name}")
        self.actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        self.cube = unreal.load_asset(CUBE)
        self.cylinder = unreal.load_asset(CYLINDER)
        self.materials = {}

    # ---- 材质 ----
    def material(self, hexcolor):
        if hexcolor in self.materials:
            return self.materials[hexcolor]
        folder = f"{ASSET_ROOT}/{self.name}"
        asset_name = f"MI_{hexcolor[1:]}"
        path = f"{folder}/{asset_name}"
        mi = unreal.load_asset(path) if unreal.EditorAssetLibrary.does_asset_exist(path) else None
        if mi is None:
            tools = unreal.AssetToolsHelpers.get_asset_tools()
            mi = tools.create_asset(asset_name, folder, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
            unreal.MaterialEditingLibrary.set_material_instance_parent(mi, unreal.load_asset(BASE_MATERIAL))
        ok = unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(mi, "Color", hex_to_linear(hexcolor))
        if not ok:
            unreal.log_warning(f"[LevelLayout] 材质没有 Color 参数，颜色 {hexcolor} 不会显示。")
        unreal.MaterialEditingLibrary.update_material_instance(mi)
        unreal.EditorAssetLibrary.save_loaded_asset(mi)
        self.materials[hexcolor] = mi
        return mi

    # ---- 通用 ----
    def place(self, actor, floor, label):
        actor.set_actor_label(label)
        actor.set_folder_path(f"LevelLayout/{self.name}/{layout_core.floor_label(floor)}")
        tags = list(actor.get_editor_property("tags"))
        tags.append(self.tag)
        actor.set_editor_property("tags", tags)
        return actor

    def clear_previous(self):
        old = [a for a in self.actors.get_all_level_actors() if self.tag in a.get_editor_property("tags")]
        for a in old:
            self.actors.destroy_actor(a)
        return len(old)

    # ---- 生成 ----
    def spawn_box(self, b, index):
        if self.blockout:
            a = self.blockout.spawn_box(b)
            return self.place(a, b.floor, f"{b.role}_{index:04d}")
        loc = unreal.Vector(*b.center)
        rot = unreal.Rotator(roll=0.0, pitch=0.0, yaw=b.yaw)
        a = self.actors.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
        comp = a.get_editor_property("static_mesh_component")
        comp.set_static_mesh(self.cube)
        comp.set_material(0, self.material(b.color))
        a.set_actor_scale3d(unreal.Vector(b.size[0] / 100.0, b.size[1] / 100.0, b.size[2] / 100.0))
        if b.role in ("water", "hazard"):
            comp.set_collision_profile_name("OverlapAllDynamic")
        return self.place(a, b.floor, f"{b.role}_{index:04d}")

    def spawn_marker(self, m, index):
        loc = unreal.Vector(*m.location)
        if m.actor == "player_start":
            a = self.actors.spawn_actor_from_class(unreal.PlayerStart, loc + unreal.Vector(0, 0, 100), unreal.Rotator())
            return self.place(a, m.floor, f"PlayerStart_{index:03d}")
        if m.actor == "camera":
            a = self.actors.spawn_actor_from_class(unreal.CameraActor, loc + unreal.Vector(0, 0, 300), unreal.Rotator(roll=0.0, pitch=-30.0, yaw=0.0))
            return self.place(a, m.floor, f"Camera_{index:03d}")
        # 占位：小圆柱 + 名字
        size = max(30.0, min(m.size_cm, 150.0))
        a = self.actors.spawn_actor_from_class(unreal.StaticMeshActor, loc + unreal.Vector(0, 0, size / 2), unreal.Rotator())
        comp = a.get_editor_property("static_mesh_component")
        comp.set_static_mesh(self.cylinder)
        comp.set_collision_profile_name("NoCollision")
        color = "#d9455f" if m.actor == "enemy_spawn" else "#4fc1b5"
        comp.set_material(0, self.material(color))
        a.set_actor_scale3d(unreal.Vector(size / 100.0, size / 100.0, size / 100.0))
        prefix = "EnemySpawn" if m.actor == "enemy_spawn" else "Marker"
        self.place(a, m.floor, f"{prefix}_{m.kind}_{index:03d}")
        self.spawn_text(m.label, m.floor, (m.location[0], m.location[1], m.location[2] + size + 20), f"Label_{index:03d}", 40)
        return a

    def spawn_text(self, text, floor, loc, label, size=60):
        # 文字平放朝上，方便在顶视图里读（方向需要在 UE 里确认，见 README“待验证”）
        a = self.actors.spawn_actor_from_class(unreal.TextRenderActor, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=90.0, yaw=0.0))
        comp = a.get_editor_property("text_render")
        comp.set_text(text)
        comp.set_world_size(size)
        comp.set_horizontal_alignment(unreal.HorizTextAligment.EHTA_CENTER)
        comp.set_text_render_color(unreal.Color(r=40, g=40, b=40, a=255))
        return self.place(a, floor, label)

    def run(self):
        removed = 0 if self.keep else self.clear_previous()
        total = len(self.plan.boxes) + len(self.plan.markers) + len(self.plan.notes)
        with unreal.ScopedSlowTask(total, f"生成白盒：{self.plan.name}") as task:
            task.make_dialog(True)
            for n, b in enumerate(self.plan.boxes):
                if task.should_cancel():
                    break
                task.enter_progress_frame(1)
                self.spawn_box(b, n)
            for n, m in enumerate(self.plan.markers):
                task.enter_progress_frame(1)
                self.spawn_marker(m, n)
            for n, note in enumerate(self.plan.notes):
                task.enter_progress_frame(1)
                self.spawn_text(note.text, note.floor, note.location, f"Note_{n:03d}")
        return removed


class BlockoutBackend:
    """
    用 Blockout Tools 的 Blockout_Box 蓝图摆盒子：带它的网格材质、可在 Details 里继续调尺寸和颜色。

    它的盒子用 BoxSize（应为厘米）控制尺寸，网格体枢轴不一定在中心。为了不依赖这些细节，
    导入前先摆一个测试盒子量一下：BoxSize 和实际尺寸的比例、枢轴相对中心的偏移，之后按量到的结果摆放。
    """

    def __init__(self, importer, cls):
        self.imp = importer
        self.cls = cls
        self.factor = (1.0, 1.0, 1.0)  # 实际尺寸 / BoxSize
        self.k = (0.0, 0.0, 0.0)  # (包围盒中心 - Actor 位置) / 实际尺寸

    @classmethod
    def load(cls, importer):
        bp = unreal.load_class(None, BLOCKOUT_BOX) if unreal.EditorAssetLibrary.does_asset_exist(BLOCKOUT_BOX.split(".")[0]) else None
        if bp is None:
            return None
        backend = cls(importer, bp)
        try:
            backend.calibrate()
        except Exception as e:
            unreal.log_warning(f"[LevelLayout] Blockout Tools 校准失败（{e}），改用引擎 Cube。")
            return None
        unreal.log(f"[LevelLayout] 使用 Blockout Tools：尺寸比例 {backend.factor}，枢轴偏移系数 {backend.k}")
        return backend

    def _spawn_raw(self, size, loc, yaw):
        a = self.imp.actors.spawn_actor_from_class(self.cls, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=0.0, yaw=yaw))
        a.set_editor_property("bRoundSize", False)  # 不要把尺寸取整，否则 10 cm 的细分格子会被放大
        a.set_editor_property("BoxSize", unreal.Vector(*size))  # 改属性会触发构造脚本重新生成
        return a

    def calibrate(self):
        test = (100.0, 200.0, 300.0)
        a = self._spawn_raw(test, (0.0, 0.0, -100000.0), 0.0)
        try:
            origin, extent = a.get_actor_bounds(False)
            loc = a.get_actor_location()
            actual = (extent.x * 2, extent.y * 2, extent.z * 2)
            if min(actual) <= 0:
                raise RuntimeError("测试盒子没有尺寸")
            self.factor = tuple(actual[i] / test[i] for i in range(3))
            off = (origin.x - loc.x, origin.y - loc.y, origin.z - loc.z)
            self.k = tuple(off[i] / actual[i] for i in range(3))
        finally:
            self.imp.actors.destroy_actor(a)

    def spawn_box(self, b):
        size = tuple(b.size[i] / self.factor[i] for i in range(3))
        # 枢轴偏移（局部坐标）转到世界坐标，再从目标中心减掉
        ox, oy, oz = (b.size[i] * self.k[i] for i in range(3))
        t = math.radians(b.yaw)
        wx, wy = ox * math.cos(t) - oy * math.sin(t), ox * math.sin(t) + oy * math.cos(t)
        a = self._spawn_raw(size, (b.center[0] - wx, b.center[1] - wy, b.center[2] - oz), b.yaw)
        a.set_editor_property("BlockoutMaterialColor", hex_to_linear(b.color))
        a.set_editor_property("bBlockoutWorldAligned", True)
        a.set_editor_property("BlockoutMaterialGridSize", BLOCKOUT_GRID_SIZE_CM * self.imp.plan.meters_per_cell)
        if b.role in ("water", "hazard"):
            a.set_editor_property("bBlockoutEnableCustomCollision", True)
            a.set_editor_property("BlockoutCustomCollisionProfileName", "OverlapAllDynamic")
        return a


def main(argv):
    opts = parse_args(argv)
    path = opts["path"] or pick_file()
    if not path:
        unreal.log_error("[LevelLayout] 没有选择工程文件。")
        return
    settings = layout_core.Settings()
    if opts["wall"]:
        settings.wall_height_m = opts["wall"]
    if opts["floor"]:
        settings.floor_height_m = opts["floor"]
    settings.floors = opts["floors"]
    try:
        plan = layout_core.build_plan(layout_core.load_project(path), settings)
    except (layout_core.LayoutError, OSError) as e:
        unreal.log_error(f"[LevelLayout] {e}")
        return
    with unreal.ScopedEditorTransaction(f"导入关卡 Layout：{plan.name}"):
        try:
            importer = Importer(plan, opts["keep"], opts["backend"])
        except RuntimeError as e:
            unreal.log_error(f"[LevelLayout] {e}")
            return
        removed = importer.run()
    unreal.log(f"[LevelLayout] 完成：{plan.name}（1 格 = {plan.meters_per_cell} m），"
               f"{len(plan.boxes)} 个盒子、{len(plan.markers)} 个图标、{len(plan.notes)} 条备注；删除了上次生成的 {removed} 个 Actor。")
    for w in plan.warnings:
        unreal.log_warning("[LevelLayout] " + w)


main(sys.argv[1:])
