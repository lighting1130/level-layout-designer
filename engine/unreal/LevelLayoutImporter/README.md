# Level Layout Importer（UE 5.8 C++ 编辑器插件）

把关卡 Layout 设计器导出的工程文件（.json）在 Unreal Engine 5.8 里一次性生成成同比例的白盒。算法和 `../prototype/`（第 0 阶段 Python 原型）一致，原型已在 UE 5.8.4 里验证过。

## 安装

1. 把整个 `LevelLayoutImporter` 文件夹复制到你的 UE 项目的 `Plugins/` 下（没有就新建），即 `你的项目/Plugins/LevelLayoutImporter/LevelLayoutImporter.uplugin`。
2. 项目需要能编译 C++：装 Visual Studio 2022（含“使用 C++ 的游戏开发”工作负载）。纯蓝图项目第一次打开时 UE 会提示编译插件，选“是”。
3. 打开项目，在 **Edit → Plugins** 里确认 **Level Layout Importer** 已启用。

## 怎么用

**菜单**：**Tools** 菜单里 **Level Layout** 一栏的 **Import Level Layout...**，选工程文件，在弹出的对话框里调整选项后点 **Import**。

**控制台 / 命令行**（Output Log 的 Cmd，或启动参数 `-ExecCmds="..."`）：

```
LevelLayout.Import D:/路径/第一关.json backend=auto levels=1,-1 wall=4 floor=5 keep nonav
LevelLayout.Remove 第一关
```

除了文件路径都是可选的；`keep` 保留上次生成的白盒，`nonav` 不加 NavMesh 范围。路径里不要有空格。

**Python / 编辑器工具蓝图**：

```python
import unreal
opts = unreal.LevelLayoutImportLibrary.get_default_import_options("D:/路径/第一关.json")
opts.backend = unreal.LevelLayoutBackend.CUBE
result = unreal.LevelLayoutImportLibrary.import_level_layout(opts)
print(result.success, result.num_boxes, result.warnings)
```

整次导入是一个撤销步骤，`Ctrl+Z` 一下全部撤掉。

## 选项

默认值在 **Project Settings → Plugins → Level Layout Importer** 里改（保存在项目的 `Config/DefaultEditor.ini`，可以提交给团队）。

| 选项 | 含义 | 默认 |
| --- | --- | --- |
| Wall Height | 墙高（米），文件里楼层或颜色没写时用 | 4 |
| Floor Height | 层高（米），第 n 层地面在 (n−1)×层高，负 n 层在 n×层高；文件里写了楼层标高时用文件的 | 5 |
| Floor Thickness | 楼板厚度，顶面在本层标高 | 0.3 |
| Liquid Depth | 水域、伤害区比地面低多少 | 0.1 |
| Levels | 只导入这些楼层（1 = 1F，-1 = B1） | 空 = 全部 |
| Replace Previous | 先删掉同名工程上次生成的 Actor | 开 |
| Backend | `Auto`：启用了 Blockout Tools 就用它的 Blockout_Box，否则用引擎 Cube；`Blockout`；`Cube` | Auto |
| Add Nav Mesh Bounds | 在整个白盒外面加一个 NavMeshBoundsVolume | 开 |
| Font | 文字用的字体，必须是 **Offline** 缓存的 Font | 空 = 有中文时自动生成 |
| Generate Cjk Font | 文字里有非 ASCII 字符且没设 Font 时，用 Windows 系统字体生成 | 开 |
| Asset Folder | 生成的材质实例、字体放在哪，后面会加工程名 | `/Game/LevelLayout` |

项目设置里另外有：

- **Icon Actor Classes**：图标 kind → 你自己的 Actor 类，比如 `enemy` → 敌人刷新点蓝图、`chest` → 宝箱蓝图。设了的图标直接生成这个类（朝向用图标的 `rot`）。kind 有 `stairs-up`、`stairs-down`、`ladder`、`door`、`locked`、`key`、`chest`、`trap`、`save`、`spawn`、`goal`、`boss`、`enemy`、`npc`、`shop`、`heal`、`item`、`switch`、`teleport`、`danger`、`camera`，自定义图标是 `u:<id>`。
- **Blockout Box Class**：Blockout Tools 的盒子蓝图路径，默认 `/BlockoutToolsPlugin/Blueprints/Blockout_Box.Blockout_Box_C`。
- **Match Grid To Cell**：Blockout 材质的网格大小设成网页里的 1 格。

## 会生成什么

| 网页里 | UE 里 |
| --- | --- |
| 颜色说明角色为“墙” | 墙，高 = 颜色的高度 → 楼层墙高 → 默认墙高。相邻格子先合并成大矩形，每个矩形一个 Blockout_Box（或引擎 Cube） |
| “地面” | 楼板，顶面在本层标高 |
| “水域”“伤害区” | 比地面低一点的薄板，碰撞为重叠 |
| “标记”“不生成” | 不生成几何 |
| 不在颜色说明里的颜色 | 按地面处理，有警告 |
| 平滑直线、弧线、未填充的闭合图形 | 沿线摆一串旋转的盒子，宽 = 线宽 |
| 填充的矩形 | 一个盒子 |
| 填充的椭圆、三角形、多边形 | 暂不支持，有警告（第 2 阶段做） |
| 图标 spawn | PlayerStart |
| 图标 camera | CameraActor |
| 在 Icon Actor Classes 里设了的图标 | 你的 Actor 类 |
| 其它图标 | 小圆柱（enemy / boss 红色，其它青色）+ 名字 |
| 备注 | 平放的 TextRenderActor，顶视图正着读 |
| — | 包住整个白盒的 NavMeshBoundsVolume |

工程文件没写 `role` 时按颜色名字猜（墙体 / 地面 / 草地 / 水域 / 岩浆/伤害区 和对应英文名），猜不到的算“标记”。

所有 Actor 放在 Outliner 的 `LevelLayout/<工程名>/<楼层>` 文件夹，带标签 `LevelLayout` 和 `LevelLayout:<工程名>`。

比例：`UE 厘米 = 世界坐标 ÷ 32 × 每格米数 × 100`。网页 x/y 直接对应 UE X/Y，不镜像。

## 中文文字

TextRender 的默认字体没有中文字形。没设 Font 时，如果备注或图标名字里有非 ASCII 字符，导入时会用本机 Windows 自带的中文字体（按顺序找微软雅黑、黑体、等线、宋体）生成一个**距离场 Offline 字体**，只包含 ASCII 和本次用到的字，存到 `<Asset Folder>/<工程名>/Font_CJK_<校验码>`。用到的字没变时直接复用。字体是用你电脑上的系统字体生成的，只存在你的 UE 项目里；本仓库不包含任何字体文件。

## 和 Blockout Tools 配合

启用了 Fab 上的 **Blockout Tools**（Dmitry Karpukhin）时，墙、地面、水域、伤害区用它的 `Blockout_Box` 生成：关掉 Round Size、颜色取颜色说明、世界对齐网格。导入前先摆一个测试盒子量出 Box Size 和实际尺寸的比例以及枢轴位置，再按量到的结果摆放。本插件不包含 Blockout Tools 的任何文件或代码，只通过资产路径和属性名（反射）引用；没装时自动用引擎 Cube。

## 测试

**Tools → Session Frontend → Automation**，搜 `LevelLayout` 运行；或者命令行：

```
UnrealEditor-Cmd.exe 你的项目.uproject -ExecCmds="Automation RunTests LevelLayout; Quit" -unattended -nullrhi
```

测试用例和 Python 原型的 `tests/test_layout_core.py` 一样，另外用 `Resources/SampleProject.json`（三层示例工程）检查生成数量。

## 源码

- `Private/LayoutPlan.*`：读工程文件、格子压平、贪心合并、平滑图形转盒子、楼层标高。不碰 Actor，便于测试。
- `Private/LayoutSceneBuilder.*`：把计划摆进关卡（Blockout / Cube、图标、文字、字体、NavMesh）。
- `Public/LevelLayoutImportLibrary.h`：给蓝图和 Python 用的接口。
- `Private/LevelLayoutImporterModule.cpp`：Tools 菜单和控制台命令。
- 源码只用 ASCII（中文写成 `\u` 转义），避免中文 Windows 下 MSVC 按 GBK 读源码出错。

## 在 UE 5.8 里的验证结果（2026-11-23）

UE 5.8.4 + VS 2022（MSVC 14.44），`RunUAT BuildPlugin` 编译无警告，7 组自动化测试全部通过。示例工程导入：

| 后端 | 结果 | 和 Python 原型对比（36 个盒子逐个） |
| --- | --- | --- |
| Auto（Blockout Tools 1.52，量到尺寸比例 1、枢轴在角上） | 36 盒子、4 图标、1 备注、1 NavMesh 范围 | 位置、尺寸最大差 0.000003 cm |
| Cube | 同上 | 最大差 0.000003 cm |

中文用微软雅黑生成的字体正常显示；一次撤销删掉全部 45 个 Actor，重做恢复；再次导入替换上次的 45 个；NavMesh 范围包住整个白盒。
