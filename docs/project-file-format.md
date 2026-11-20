# 工程文件格式

点击工具栏的“导出”（或 `Ctrl+S`）会把当前关卡保存为一个 `.json` 工程文件；“导入”（`Ctrl+O`，或直接把文件拖进画布）可以重新打开它。

```json
{
  "format": "level-layout-designer",
  "version": 1,
  "name": "第一关 森林",
  "exportedAt": "2026-11-20T09:40:00.000Z",
  "grid": { "cellSize": 32, "subdivision": 10 },
  "view": { "x": 0, "y": 0, "zoom": 1 },
  "legend": [
    { "name": "墙体", "color": "#8b93a3" }
  ],
  "cells": [
    { "k": 0, "i": 3, "j": -2, "color": "#8b93a3" }
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
| `cells` | 涂色的格子，后面的覆盖前面的 |

格子坐标：层级 `k` 的格子边长为 `cellSize × subdivision^k`（`k = 0` 是基础格子，`k = -1` 是 1/10 格，`k = 1` 是 10×10 格），`(i, j)` 是它在该层级中的列号和行号，左上角世界坐标为 `(i × 边长, j × 边长)`。换算成基础格子坐标：`x = i × 10^k`，`y = j × 10^k`。
