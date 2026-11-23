# 工程文件格式

点击工具栏的“导出”（或 `Ctrl+S`）会把当前关卡保存为一个 `.json` 工程文件；“导入”（`Ctrl+O`，或直接把文件拖进画布）可以重新打开它。

```json
{
  "format": "level-layout-designer",
  "version": 5,
  "name": "第一关 森林",
  "exportedAt": "2026-11-20T09:40:00.000Z",
  "grid": { "cellSize": 32, "subdivision": 10 },
  "view": { "x": 0, "y": 0, "zoom": 1 },
  "legend": [
    { "id": "wall", "name": "墙体", "color": "#8b93a3", "role": "wall" },
    { "id": "c1kq2x9ab", "name": "矮墙", "color": "#6b7383", "role": "wall", "height": 1.2 }
  ],
  "currentFloor": 1,
  "floors": [
    {
      "level": 1,
      "elevation": 0,
      "wallHeight": 4,
      "cells": [
        { "k": 0, "i": 3, "j": -2, "color": "#8b93a3" }
      ],
      "vectors": [
        {
          "kind": "arc", "a": { "x": 0, "y": 0 }, "b": { "x": 320, "y": 0 }, "bend": { "x": 160, "y": -96 },
          "constrain": false, "color": "#f2c14e", "width": 16, "fill": false
        }
      ],
      "notes": [
        { "x": 96, "y": -64, "text": "这里放 Boss，二阶段会开门" }
      ]
    },
    { "level": -1, "cells": [], "vectors": [], "notes": [] }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `format` / `version` | 固定为 `level-layout-designer`，版本号用于以后升级格式 |
| `name` | 工程名称，也是导出的文件名 |
| `grid.cellSize` | 基础格子边长（世界单位） |
| `grid.subdivision` | 每一级细分的倍数（10 表示每格细分为 10×10） |
| `view` | 导出时屏幕中心的世界坐标和缩放，导入后恢复到这个视角 |
| `legend` | 右侧“颜色说明”面板的内容，按顺序 |
| `legend[].id` | 稳定的 id（版本 5），改名改色都不变 |
| `legend[].role` | 导入游戏引擎时这种颜色生成成什么（版本 5）：`wall` 墙、`floor` 地面、`water` 水域、`hazard` 伤害区、`marker` 标记（不生成几何）、`none` 忽略。旧文件没有时按名字猜（墙体 → wall，地面/草地 → floor，水域 → water，岩浆/伤害区 → hazard，其它 → marker） |
| `legend[].height` | 这种颜色的高度（米，版本 5，可选），只对 `wall` 有意义，比如矮墙；不写用楼层的 `wallHeight` |
| `images` | 参考图数据（版本 4 新增）：`{ id: "data:image/webp;base64,..." }` |
| `customIcons` | 用户导入的图标库：`[{ "id", "name" }]`，`id` 对应 `images` 里的图片 |
| `iconLabels` | 图标说明（可选）：`{ 图标 kind: "用户写的含义" }`，没写的用图标默认名字 |
| `currentFloor` | 导出时所在的楼层 |
| `metersPerCell` | 一个基础格子（`grid.cellSize`，缩放 100% 时的格子）代表的现实长度，单位米（可选，默认 1） |
| `floors` | 各楼层的内容（版本 3 新增），按楼层号从高到低 |
| `floors[].level` | 楼层号：1 = 第一层，2 = 第二层，-1 = 负一层……没有 0 |
| `floors[].elevation` | 这一层地面的标高（米，版本 5，可选）。不写时引擎按默认层高 5 m 推算：第 n 层 (n−1)×5，负 n 层 −n×5 |
| `floors[].wallHeight` | 这一层的墙高（米，版本 5，可选），不写默认 4 m |
| `floors[].cells` | 该层涂色的格子，后面的覆盖前面的 |
| `floors[].vectors` | 该层平滑模式画的弧线和图形，画在格子之上 |
| `floors[].images` | 该层的参考图（版本 4 新增，可选）：`{ "id", "x", "y", "w", "h", "opacity", "locked", "rot" }`，位置和大小是世界坐标（未旋转时的范围），`rot` 是绕图片中心顺时针旋转的角度（度，-180 到 180，0 时省略），图片数据在顶层 `images[id]` |
| `floors[].icons` | 该层的关卡图标（可选）：`{ "kind", "x", "y", "size" }`，`x`/`y` 是图标中心的世界坐标，`size` 是边长；`kind` 是内置图标名（如 `stairs-up`、`chest`、`trap`、`save`），或 `"u:<图片 id>"` 表示自定义图标；可选的 `rot`（版本 5）是朝向，顺时针角度 0–360，0 = 朝右（画布 +x，也就是 UE 的 +X），缺省为 0。框选后按 R 旋转时朝向跟着转 90° |
| `floors[].notes` | 该层的文字备注（可选）：`{ "x", "y", "text" }`，`x`/`y` 是备注钉子的世界坐标（单位同 `vectors`）；可选的 `ox`/`oy` 是便签左下角相对钉子的屏幕像素偏移，缺省为 `10`/`-10` |

格子坐标：层级 `k` 的格子边长为 `cellSize × subdivision^k`（`k = 0` 是基础格子，`k = -1` 是 1/10 格，`k = 1` 是 10×10 格），`(i, j)` 是它在该层级中的列号和行号，左上角世界坐标为 `(i × 边长, j × 边长)`。换算成基础格子坐标：`x = i × 10^k`，`y = j × 10^k`。

平滑图形：`kind` 为 `arc`、`line`、`rect`、`ellipse`、`triangle`、`diamond`、`hexagon`、`polygon` 之一（`polygon` 另有 `sides` 字段，表示 3–64 的边数）；`a`、`b` 是世界坐标下的起点和终点（图形为外接框的两个对角），`bend` 是弧线经过的控制点（弧线为过 `a`、`bend`、`b` 三点的圆弧），`constrain` 表示按住 Shift 画的正图形，`width` 是世界坐标下的线宽（基础格子边长为 32），`fill` 表示是否填充内部。
版本 1、2 的工程文件把 `cells` / `vectors` 放在顶层、没有楼层，导入时会当作“第一层”。

弧线（`kind: "arc"`）和直线（`kind: "line"`）的平滑图形可以有可选字段 `arrow`：`"end"`、`"start"` 或 `"both"`，表示在终点、起点或两端画箭头。

框选旋转过的三角形、菱形、六边形、多边形和矩形可以有可选字段 `rot`（1–3）：图形顺时针转了几个 90°。此时 `a`、`b` 是旋转后的外接框，图形先在“转回去”的外接框里生成，再绕中心旋转。

版本 3 的文件没有参考图，可以直接导入。

版本 5 新增的字段（`legend[].id/role/height`、`floors[].elevation/wallHeight`、`floors[].icons[].rot`）都是给游戏引擎导入用的，都可选；网页画图不使用它们。版本 4 及更早的文件照常导入。UE 导入插件见 `engine/unreal/`。
