# UE 白盒导入：第 0 阶段原型（Python）

把关卡 Layout 设计器导出的工程文件（.json）在 Unreal Engine 5.8 里一次性生成成同比例的白盒，用来验证**比例、坐标方向和第三人称动作 RPG 的默认尺寸**。正式插件（C++）见设计文档里的第 1 阶段。

## 怎么用

1. UE 5.8.4 打开项目（建议先用第三人称模板项目试），在 **Edit → Plugins** 里确认 **Python Editor Script Plugin** 已启用，重启编辑器。
2. 打开要生成白盒的关卡。
3. 在 **Output Log** 底部把输入框左边的 `Cmd` 切成 `Python`，或者直接在 `Cmd` 里输入：

   ```
   py "D:/路径/level-layout-designer/engine/unreal/prototype/import_layout.py" "D:/路径/第一关.json"
   ```

   不写工程文件路径时会尝试弹出文件选择框。可以先用仓库里的 `tests/sample-project.json` 试。

可选参数：

| 参数 | 含义 | 默认 |
| --- | --- | --- |
| `--wall 4` | 墙高（米） | 4 |
| `--floor 5` | 层高（米），第 n 层地面在 (n−1)×层高，负 n 层在 n×层高 | 5 |
| `--floors 1,-1` | 只导入这些楼层 | 全部 |
| `--keep` | 保留上次生成的白盒（默认先删掉同名工程上次生成的 Actor） | 关 |
| `--backend auto\|blockout\|cube` | 墙和地面用 Blockout Tools 的蓝图还是引擎 Cube | `auto`：装了 Blockout Tools 就用它 |

整次导入是一个撤销步骤，`Ctrl+Z` 一下全部撤掉。

## 会生成什么

| 网页里 | UE 里 |
| --- | --- |
| 颜色说明叫“墙体”的格子 | 墙，高 = 墙高。相邻格子先合并成大矩形，每个矩形一个 Blockout_Box（或引擎 Cube） |
| “地面”“草地” | 30 cm 厚楼板，顶面在本层标高 |
| “水域”“岩浆/伤害区” | 比地面低 10 cm 的薄板，碰撞为重叠（之后换成 Volume） |
| 其它颜色（出生点、敌人等颜色） | 不生成几何 |
| 不在颜色说明里的颜色 | 按地面处理，日志里有警告 |
| 平滑直线、弧线、未填充的闭合图形 | 沿线摆一串旋转的盒子，宽 = 线宽 |
| 填充的矩形 | 一个盒子 |
| 填充的椭圆、三角形、多边形 | **原型暂不支持**，日志里有警告（第 2 阶段用 Geometry Script 做） |
| 图标 spawn | PlayerStart |
| 图标 camera | CameraActor |
| 图标 enemy / boss | 红色小圆柱 `EnemySpawn_*` + 名字 |
| 其它图标 | 青色小圆柱 `Marker_*` + 名字（用“图标说明”里写的含义） |
| 备注 | 平放的 TextRenderActor |

比例：`UE 厘米 = 世界坐标 ÷ 32 × 每格米数 × 100`。网页 x/y 直接对应 UE X/Y，不镜像。

所有 Actor 放在 Outliner 的 `LevelLayout/<工程名>/<楼层>` 文件夹，带标签 `LevelLayout:<工程名>`；颜色材质实例在 `/Game/LevelLayoutPrototype/<工程名>/`。

## 和 Blockout Tools 插件配合

如果项目里启用了 Fab 上的 **Blockout Tools**（Dmitry Karpukhin，引擎插件目录 `Plugins/Marketplace/Blockout…`），墙、地面、水域、伤害区会用它的 `Blockout_Box` 蓝图生成，而不是引擎 Cube：

- 自带三向投影网格材质，网格大小设成网页里的 1 格（`1 格 = N m` 时为 N×100 cm），颜色取颜色说明里的颜色。
- 生成后就是普通的 Blockout Box，可以在 Details 里继续改 Box Size、颜色，或者和 Blockout Tools 里手摆的门洞、楼梯、栏杆混用。
- 关掉了 `Round Size`，否则 10 cm 的细分格子会被取整放大。
- 导入前会先摆一个测试盒子，量出 `BoxSize` 和实际尺寸的比例以及枢轴位置，再按量到的结果摆放，所以不依赖它的网格体枢轴在哪。

本仓库不包含 Blockout Tools 的任何文件或代码（它是商业插件），只在你本机装了时按资产路径 `/BlockoutToolsPlugin/Blueprints/Blockout_Box` 引用。没装或者加 `--backend cube` 时用引擎 Cube。

## 文件

- `layout_core.py`：读工程文件、格子压平（细格子覆盖粗格子）、贪心合并矩形、平滑图形转盒子、单位换算。**不依赖 Unreal**，可以直接 `python layout_core.py 工程.json` 看生成摘要。
- `import_layout.py`：在 UE 里摆 Actor。
- `tests/`：`python -m unittest discover -s tests` 运行离线测试；`sample-project.json` 是测试用的示例工程（三层：2F、1F、B1，含房间、门洞、水池、伤害区、弧形墙、细分格子柱子、图标和备注）。

## 在 UE 5.8 里的验证结果（2026-11-23）

在一台装了 UE 5.8 和 Blockout Tools 1.52 的电脑上，用空白测试项目导入 `tests/sample-project.json`，Blockout 和 Cube 两种模式都跑过：

| 检查项 | 结果 |
| --- | --- |
| 无报错跑完 | 通过：36 个盒子、4 个图标、1 条备注，只有“填充椭圆暂不支持”这一条预期警告 |
| 方向 | 通过，没有镜像：门洞在 +Y 侧，弧形墙在门洞外，水池在 +X 半边 |
| 尺寸和位置 | 通过：逐个对比 36 个 Actor 的网格体包围盒和计划值，最大误差 0.000003 cm；1F 北墙 14 m × 1 m × 4 m |
| Blockout 校准 | 通过：尺寸比例 (1, 1, 1)，枢轴在盒子角上；Python 改 BoxSize 后构造脚本立即重新生成 |
| 颜色 | 通过（两种模式） |
| 楼层 | 通过：2F 地面在 Z = 500 cm，B1 在 −500 cm |
| 文字朝向 | 通过：顶视图正着读 |
| **中文文字** | **未解决**：TextRender 默认字体没有中文字形，备注和图标名字里的中文显示成方框。需要给 TextRender 指定一个带中文的字体资产 |

还没测：大地图（上万个格子）的生成速度。
