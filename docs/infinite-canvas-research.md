# 开源无限画布项目调研

> 调研日期：2026-11-20
> 目的：为「关卡设计 layout 画图工具」选择技术路线，并从最优秀的开源无限画布项目中学习架构。
> 说明：本次直接克隆了主要项目的源码阅读（最近提交日期取自各仓库 `main` 分支）。GitHub 搜索 API 当时不可用，Star 数为量级估计，仅供参考。

## 1. 候选项目总览

项目分成三类：**完整的白板/画布应用**（可以直接学习整套编辑器架构）、**画布渲染引擎**（只负责画，编辑器逻辑要自己写）、**同领域参考**（关卡/地图编辑器）。

### 1.1 完整的无限画布应用 / SDK

| 项目 | Star 量级 | 技术栈 | 许可证 | 最近提交 | 特点 |
|---|---|---|---|---|---|
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 10 万+ | React + Canvas 2D + rough.js | MIT | 2026-11-19 | 手绘风白板，最流行；元素类型固定，扩展自定义图形较难 |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | 4 万+ | React + DOM/SVG + 自研响应式 Store | **tldraw 自有许可（非开源）** | 2026-11-19 | 架构最完整、最可扩展的无限画布 SDK |
| [plait-board/drawnix](https://github.com/plait-board/drawnix) | 万级 | React + Plait 框架 + SVG | MIT | 2026-09-07 | 国产一体化白板（思维导图、流程图、自由画） |
| [toeverything/blocksuite](https://github.com/toeverything/blocksuite)（AFFiNE 底座） | 数千 | Lit + Canvas/DOM 混合 | MPL-2.0 | 2025-07-07 | 文档+白板一体，近一年主仓库活跃度下降 |
| [xyflow/xyflow](https://github.com/xyflow/xyflow)（React Flow / Svelte Flow） | 3 万+ | React/Svelte + DOM | MIT | 2026-11-17 | 节点-连线图专用，不适合自由几何 |
| [antvis/X6](https://github.com/antvis/X6) | 数千 | SVG + 图编辑引擎 | MIT | 2026-11-13 | 蚂蚁的图编辑引擎，偏流程图/ER 图 |

### 1.2 画布渲染引擎（需要自己写编辑器层）

| 项目 | Star 量级 | 渲染方式 | 许可证 | 最近提交 | 特点 |
|---|---|---|---|---|---|
| [pixijs/pixijs](https://github.com/pixijs/pixijs) | 4 万+ | WebGL / WebGPU | MIT | 活跃 | 2D 游戏级性能，适合大量 tile/精灵 |
| [davidfig/pixi-viewport](https://github.com/davidfig/pixi-viewport) | 千级 | 基于 PixiJS | MIT | 2026-11-14 | 给 Pixi 加平移、缩放、惯性、边界限制的相机 |
| [fabricjs/fabric.js](https://github.com/fabricjs/fabric.js) | 3 万左右 | Canvas 2D 对象模型 | MIT | 2026-11-10 | 自带选择、变换控制柄、序列化 |
| [konvajs/konva](https://github.com/konvajs/konva)（+ react-konva） | 万级 | Canvas 2D 场景图 | MIT | 2026-11-19 | 分层 Canvas、命中检测、Transformer，与 React 集成好 |
| [leaferjs/leafer-ui](https://github.com/leaferjs/leafer-ui) | 数千 | Canvas 2D，主打大规模图形性能 | MIT | 2026-11-16 | 国产，内置无限画布视口与编辑器插件，中文文档完善 |

### 1.3 同领域参考（游戏关卡/地图编辑器）

| 项目 | 技术栈 | 许可证 | 最近提交 | 可借鉴点 |
|---|---|---|---|---|
| [deepnight/ldtk](https://github.com/deepnight/ldtk) | Haxe + Electron | MIT | 2026-10-06 | 关卡数据模型（Layer / IntGrid / Entity / AutoLayer 规则）、JSON 导出格式 |
| [mapeditor/tiled](https://github.com/mapeditor/tiled) | C++ / Qt | GPL-2.0（libtiled 为 BSD） | 活跃 | 业界标准 TMX/TMJ 格式、对象层、图块集 |

## 2. 对比结论：哪个“最好”

从**编辑器架构的完整度和设计质量**来看，**tldraw 是最好的学习对象**：

- 它把无限画布拆成了清晰的层次：响应式状态（`@tldraw/state`）→ 记录存储（`@tldraw/store`）→ 数据模式与迁移（`@tldraw/tlschema`）→ 编辑器内核（`@tldraw/editor`）→ 默认图形与 UI（`tldraw`）→ 多人协作（`@tldraw/sync`）。
- 自定义图形、自定义工具、自定义 UI 都是一等公民，这正是关卡编辑器需要的（房间、门、刷怪点、路径、碰撞区都可以是自定义图形）。
- 撤销/重做、吸附、空间索引、视口裁剪、数据迁移、协作都有成熟实现。

但是 **tldraw 的许可证不允许我们直接用在生产环境**：

- `LICENSE.md` 明确写着只允许在开发环境使用，**不得用于生产环境**，除非购买商业许可或使用试用 License Key；软件内含 License Key 校验和水印，且不得绕过。
- 因此结论是：**学习它的设计思想，不复制它的代码，也不依赖它的包**。

Excalidraw 虽然是 MIT 且最流行，但它的元素类型是写死在核心里的（矩形、椭圆、箭头、文本……），加入“房间 / 图块 / 刷怪点”这类领域对象需要大量改核心代码，更适合当作 Canvas 渲染和协作合并（`version` / `versionNonce`、分数索引排序）的参考。

## 3. tldraw 架构精读

以下基于 tldraw `main` 分支源码（2026-11-19）。

### 3.1 状态层：信号（Signals）+ 记录存储（Store）

- `packages/state`：自研的细粒度响应式库，核心是 `atom()`（可写值）和 `computed()`（派生值），有依赖追踪和“epoch”增量计算。编辑器里几乎所有值（相机、选中项、当前工具、可见图形）都是 `computed`，UI 自动按需刷新。
- `packages/store`：把整个文档存成**扁平的记录表**（`id → record`），每条记录有 `typeName`（shape / page / binding / asset / camera / instance…）。
  - 每次修改产生一个 `RecordsDiff`（added / updated / removed），这是**撤销、持久化、协作的共同基础**。
  - `StoreSchema` + `migrate.ts`：每种记录都带版本号和迁移函数，旧文件打开时自动升级。
  - `StoreSideEffects`：在创建/更新/删除前后挂钩子，用来维护约束（例如删除被绑定的图形时一起清理绑定）。

**对我们的启发**：关卡文档也应该是“扁平记录表 + 版本化 schema”，不要用深层嵌套的对象树。图层、房间、实体、连线全是记录，用 `parentId` 表示层级。

### 3.2 图形模型：ShapeUtil

每种图形 = 一条数据记录 + 一个 `ShapeUtil` 类（`packages/editor/src/lib/editor/shapes/ShapeUtil.ts`）。

- 记录（`TLBaseShape`）：`id, type, x, y, rotation, parentId, index, isLocked, opacity, props, meta`。`props` 是该类型的专属属性，`meta` 留给使用者放自定义数据。
- `index` 是**分数索引**（fractional index，如 `'a1'`），用来表示同层内的前后顺序。插入、移动只改一个字符串，不用重排整张表，协作时也不易冲突。
- `ShapeUtil` 必须实现：
  - `getDefaultProps()`：默认属性
  - `getGeometry()`：返回 `Geometry2d`，用于命中检测、包围盒、吸附、框选
  - `component()`：如何渲染
  - `getIndicatorPath()`：选中时的描边
- 可选钩子很多：`onResize / onRotate / onTranslate / onHandleDrag / onDoubleClick / onBeforeUpdate / onDragShapesIn(Out)` 等，以及 `getHandles()`（例如线段端点）、`toSvg()`（导出）。

**对我们的启发**：这是最值得照搬的设计。关卡里的“房间”“墙”“门”“出生点”“巡逻路径”“触发区”都应该是一个 ShapeUtil：几何（用于碰撞/吸附）与渲染分离，交互行为通过钩子定制。

### 3.3 相机与坐标系

- 相机是一条记录 `{x, y, z}`，`z` 为缩放。坐标换算极其简单（`Editor.ts` 中 `screenToPage` / `pageToScreen`）：
  - 屏幕 → 页面：`(screen - screenBounds) / z - camera`
  - 页面 → 屏幕：`(page + camera) * z + screenBounds`
- `setCameraOptions` 支持缩放档位、缩放上下限、平移约束（限制在某个范围内）、滚轮行为（缩放还是平移）。
- 渲染时只给整个 HTML 图层设置一个 CSS `transform`（`getHtmlLayerTransform`），平移缩放不需要重绘每个图形。

**对我们的启发**：相机 = 一个平移 + 一个缩放，所有工具只在“页面坐标”上工作。关卡编辑器应当额外提供“网格坐标”（`page / cellSize` 取整），吸附到格子就是在这一步做。

### 3.4 渲染与性能

- tldraw 每个图形是一个 DOM 节点（内部多为 SVG），由 React 渲染，靠 CSS transform 定位。优点是文字、富文本、嵌入网页非常方便；缺点是图形数量到上万时 DOM 开销大。
- 性能手段：
  - **空间索引**：`SpatialIndexManager` 用 R-tree（RBush）存所有图形包围盒，增量更新，只重算受影响的图形（父子、绑定关系），查询 O(log n)。
  - **视口裁剪**：`getCulledShapes()` 只渲染视口内的图形，视口外的隐藏。
  - **LOD**：缩放很小时关掉文字描边等昂贵效果。

**对我们的启发**：关卡地图里图块（tile）可能成千上万，DOM 方案扛不住。我们应保留 tldraw 的“空间索引 + 视口裁剪 + LOD”思路，但**渲染层换成 Canvas/WebGL**（见第 5 节）。

### 3.5 工具系统：分层状态机（StateNode）

- 每个工具是一个 `StateNode`（`tools/StateNode.ts`），可以有子状态，形成状态树。例如选择工具 `SelectTool` 的子状态：`Idle → PointingShape → Translating`、`PointingResizeHandle → Resizing`、`PointingRotateHandle → Rotating`、`Brushing`（框选）、`EditingShape`、`DraggingHandle` 等。
- 所有输入事件（pointer / keyboard / wheel / pinch / tick）从根节点向当前激活路径分发，当前路径如 `select.translating`。
- 新增绘图工具一般继承 `BaseBoxShapeTool`，几行代码就能做出“拖拽画一个矩形图形”的工具。

**对我们的启发**：关卡编辑器工具多（选择、画墙、画房间、刷图块、橡皮擦、放置实体、画路径、测距），用分层状态机比在一个大 `onMouseMove` 里写 `if/else` 好维护得多，也方便测试。

### 3.6 撤销 / 重做

- `HistoryManager` 拦截 Store 的每一次“用户来源”修改，把 diff 累积到 `pendingDiff`，在 `markHistoryStoppingPoint()` 时合并成一个撤销步骤。
- 撤销 = 应用反向 diff（`reverseRecordsDiff`），连续拖拽产生的大量 diff 会被 `squash` 成一步。
- 支持暂停记录、保留重做栈等模式（比如相机移动不进历史）。

**对我们的启发**：基于 diff 的撤销比“命令模式”省事，任何改动天然可撤销。刷图块这种高频操作要在 pointerup 时打一个 stopping point，合成一步。

### 3.7 其他值得学习的点

- **Bindings（绑定）**：箭头和图形的连接是独立记录，不塞在图形里。对应关卡里的“门连接两个房间”“传送点 A ↔ B”。
- **SnapManager**：包围盒吸附（边、中心、等间距）+ 控制点吸附，吸附线可视化。
- **Pages**：多页面。可对应关卡的多个楼层 / 多个关卡。
- **持久化与协作**：本地用 IndexedDB 保存 Store 快照；`@tldraw/sync` 基于 diff 做多人实时协作。

## 4. Excalidraw 的补充参考（MIT，可以直接借鉴代码）

- **双 Canvas 渲染**：`renderer/staticScene.ts` 画静态内容，`renderer/interactiveScene.ts` 画选框、控制柄等交互层。静态层只在内容变化时重绘，交互层随鼠标重绘。这个分层思路非常适合我们。
- **元素级缓存**：每个元素先画到离屏 Canvas 再贴图，缩放变化时才重建。
- **协作合并**：元素带 `version` 和 `versionNonce`，合并时取版本更高者。
- **分数索引**：自带 `packages/fractional-indexing`，与 tldraw 同样用分数索引排序。
- **导出**：`staticSvgScene.ts` 导出 SVG。

## 5. 对本项目的建议

### 5.1 技术路线

**推荐：自研编辑器内核（照 tldraw 的架构思路）+ MIT 渲染引擎**

| 层 | 建议 | 理由 |
|---|---|---|
| 语言 / 框架 | TypeScript + React（UI 面板） | 生态成熟，tldraw/Excalidraw 都是这一套 |
| 渲染 | **PixiJS（WebGL）** 为主，或 Konva（Canvas 2D） | 关卡有大量图块和网格，WebGL 性能余量最大；Konva 上手更快 |
| 相机 | 自写（`{x, y, z}` + 屏幕/页面/网格坐标换算），或用 pixi-viewport | 逻辑很简单，自己写更可控 |
| 状态 | 扁平记录表 + 版本化 schema + diff | 撤销、保存、协作共用一套机制 |
| 工具 | 分层状态机（类似 StateNode） | 工具多，易扩展、易测试 |
| 空间索引 | RBush（MIT） | 命中检测、框选、视口裁剪 |
| 排序 | 分数索引（`fractional-indexing`，CC0/MIT） | 图层内排序、协作友好 |
| 文件格式 | 自有 JSON，后续可导出 Tiled TMJ / LDtk 格式 | 方便接入游戏引擎 |

备选：如果希望最快出一个可用原型，可以直接基于 **Leafer UI**（MIT，自带无限画布视口和编辑器插件）或 **Konva + react-konva** 起步，再逐步加入关卡领域的功能。

**不建议**：直接基于 tldraw 开发（许可证限制生产使用，需要商业授权）；直接 fork Excalidraw（元素类型写死，改造成本高）。

### 5.2 关卡编辑器需要而通用白板没有的能力

1. **网格系统**：可配置格子大小，正方形/六边形/等距（isometric）网格；吸附到格子、格子坐标显示。
2. **图块层（Tile Layer）**：按格子存稀疏数据（`Map<"x,y", tileId>`），分块（chunk）渲染，而不是每个图块一个对象。
3. **图层**：地面、墙体、装饰、实体、碰撞、触发器等，可锁定/隐藏/调透明度。
4. **领域对象**：房间、门、出生点、敌人、道具、路径点、触发区，属性面板可编辑自定义字段（参考 LDtk 的 Entity 字段定义）。
5. **连接关系**：门连接房间、传送点配对，用独立的 binding 记录表示。
6. **导出**：PNG/SVG 预览图 + 引擎可读的 JSON。

### 5.3 建议的第一步（等需求确认后再开始）

1. 搭项目骨架（Vite + TypeScript + React）。
2. 实现内核最小闭环：记录 Store + diff 撤销 + 相机平移缩放 + 背景网格。
3. 实现选择工具和矩形“房间”图形，验证 ShapeUtil 式的扩展机制。
4. 再加入图块层和图层面板。

## 6. 参考链接

- tldraw 源码：https://github.com/tldraw/tldraw （许可证：仓库内 `LICENSE.md`）
- tldraw 文档：https://tldraw.dev
- Excalidraw 源码：https://github.com/excalidraw/excalidraw
- PixiJS：https://github.com/pixijs/pixijs ，pixi-viewport：https://github.com/davidfig/pixi-viewport
- Konva：https://github.com/konvajs/konva
- Leafer UI：https://github.com/leaferjs/leafer-ui
- Fabric.js：https://github.com/fabricjs/fabric.js
- React Flow：https://github.com/xyflow/xyflow
- Drawnix：https://github.com/plait-board/drawnix
- LDtk：https://github.com/deepnight/ldtk
- Tiled：https://github.com/mapeditor/tiled
- RBush：https://github.com/mourner/rbush
