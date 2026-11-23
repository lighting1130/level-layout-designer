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

整次导入是一个撤销步骤，`Ctrl+Z` 一下全部撤掉。

## 会生成什么

| 网页里 | UE 里 |
| --- | --- |
| 颜色说明叫“墙体”的格子 | 引擎 Cube 缩放成的墙，高 = 墙高。相邻格子先合并成大矩形，每个矩形一个 Actor |
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

## 文件

- `layout_core.py`：读工程文件、格子压平（细格子覆盖粗格子）、贪心合并矩形、平滑图形转盒子、单位换算。**不依赖 Unreal**，可以直接 `python layout_core.py 工程.json` 看生成摘要。
- `import_layout.py`：在 UE 里摆 Actor。
- `tests/`：`python -m unittest discover -s tests` 运行离线测试；`sample-project.json` 是测试用的示例工程（三层：2F、1F、B1，含房间、门洞、水池、伤害区、弧形墙、细分格子柱子、图标和备注）。

## 待验证（只能在 UE 里确认）

原型的几何计算已经离线测过，下面这些依赖 UE 的行为还没在编辑器里跑过：

1. 网页里的房间在 UE 顶视图里方向一致、没有被镜像（门洞在下方，弧形墙在房间下方）。
2. 用第三人称模板角色走一圈：4 m 墙、2 m 门洞、5 m 层高的手感。
3. 颜色材质：`BasicShapeMaterial` 的 `Color` 参数能否正常显示颜色。
4. 备注和图标名字的文字朝向（平放后从顶视图是否正着读）。
5. 大地图（上万个格子）的生成速度。
