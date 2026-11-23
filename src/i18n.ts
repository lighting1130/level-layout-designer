/**
 * 中英文切换。界面文字以中文为键，英文在 EN 里；没有翻译的文字原样显示中文。
 * 带变量的文字用 {name} 占位：t("已删除 {n} 项", { n: 3 })。
 */
export type Lang = "zh" | "en";
const LANG_KEY = "level-layout-designer.lang.v1";

let lang: Lang = "zh";
try {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "zh" || saved === "en") lang = saved;
  else if (!/^zh/i.test(navigator.language || "zh")) lang = "en";
} catch { /* 忽略 */ }

export const getLang = () => lang;

export function t(zh: string, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? EN[zh] ?? zh : zh;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

// ---------------- 页面里写死的文字：启动时记下中文原文，切换语言时重新填 ----------------
const ATTRS = ["title", "aria-label", "placeholder"] as const;
const HAN = /[一-鿿]/;
const captured: { apply(): void }[] = [];

/** 记下静态页面中的中文（必须在脚本动态生成内容之前调用） */
export function captureStatic(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const orig = node.nodeValue ?? "";
    if (!HAN.test(orig)) continue;
    const lead = orig.match(/^\s*/)![0], trail = orig.match(/\s*$/)![0];
    const key = orig.trim();
    captured.push({ apply: () => { node.nodeValue = lead + t(key) + trail; } });
  }
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && HAN.test(v)) captured.push({ apply: () => el.setAttribute(a, t(v)) });
    }
  }
}

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* 忽略 */ }
  document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  document.title = t("关卡 Layout 设计器");
  for (const c of captured) c.apply();
}

const EN: Record<string, string> = {
  // 页面
  "关卡 Layout 设计器": "Level Layout Designer",
  "工程名称": "Project name",
  "工程名称（也是导出的文件名）": "Project name (also used as the file name)",
  "把当前关卡导出为工程文件 (Ctrl+S)": "Save the map as a project file (Ctrl+S)",
  "导出": "Export",
  "打开之前导出的工程文件 (Ctrl+O)": "Open a saved project file (Ctrl+O)",
  "导入": "Import",
  "把楼层导出成 PNG 图片，底部带颜色和图标说明 (Ctrl+Shift+S)": "Export levels as PNG images with a color and icon key (Ctrl+Shift+S)",
  "导出图片": "Export image",
  "导入一张参考图垫在格子下面（也可以直接把图片拖进画布，或 Ctrl+V 粘贴截图）": "Import a reference image under the cells (or drag an image onto the canvas, or paste with Ctrl+V)",
  "参考图": "Reference",
  "撤销 (Ctrl+Z)": "Undo (Ctrl+Z)",
  "撤销": "Undo",
  "重做 (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
  "重做": "Redo",
  "清空当前楼层（可撤销）": "Clear the current level (undoable)",
  "清空": "Clear",
  "工具": "Tools",
  "框选：拖框选中，拖动移动；Delete 删除 (V)": "Select: drag a box to select, drag to move, Delete to remove (V)",
  "框选": "Select",
  "画笔 (B)": "Brush (B)",
  "画笔": "Brush",
  "橡皮 (E)": "Eraser (E)",
  "橡皮": "Eraser",
  "弧线：设定起点和终点，再调弯曲 (A)": "Arc: set start and end, then adjust the bend (A)",
  "弧线": "Arc",
  "几何图形 (G)": "Shapes (G)",
  "图形": "Shape",
  "备注：点击画布添加文字备注 (N)": "Note: click the canvas to add a text note (N)",
  "备注": "Note",
  "图标：楼梯、宝箱、陷阱、记录点等，点击画布放置 (I)": "Icons: stairs, chests, traps, save points and more; click to place (I)",
  "图标": "Icon",
  "平移 (H，或按住空格拖拽)": "Pan (H, or hold Space and drag)",
  "平移": "Pan",
  "当前颜色（在右侧颜色说明里切换）": "Current color (pick it in the key on the right)",
  "楼层": "Levels",
  "是否半透明显示其他楼层": "Show other levels faded",
  "显示其他层": "Show others",
  "在最上面加一层": "Add a level on top",
  "+ 上加一层": "+ Level above",
  "在最下面加一层（地下层）": "Add a level at the bottom (basement)",
  "+ 下加一层": "+ Level below",
  "删除当前楼层（不可撤销）": "Delete the current level (cannot be undone)",
  "删除当前层": "Delete level",
  "确认删除？": "Really delete?",
  "勾选后内部也填满颜色": "Fill the inside with color too",
  "填充": "Fill",
  "正多边形的边数（3–64）": "Number of sides (3–64)",
  "边数": "Sides",
  "减少边数": "Fewer sides",
  "多边形边数": "Polygon sides",
  "增加边数": "More sides",
  "边": "sides",
  "选择图标": "Choose an icon",
  "自定义图标名称": "Custom icon name",
  "修改这个自定义图标的名字": "Rename this custom icon",
  "从图标库移除（画布上已放的不受影响）": "Remove from the library (placed icons stay)",
  "移除": "Remove",
  "用自己的图片（PNG / SVG / JPG / WebP）做图标，可一次选多张": "Use your own images (PNG / SVG / JPG / WebP) as icons; pick several at once",
  "+ 导入图标": "+ Import icons",
  "图标边长，单位是当前笔刷格子": "Icon size in brush cells",
  "大小": "Size",
  "缩小图标": "Smaller icon",
  "图标大小（格）": "Icon size (cells)",
  "放大图标": "Larger icon",
  "格": "cells",
  "模式": "Mode",
  "绘制模式": "Drawing mode",
  "按格子逐格填色": "Fill cell by cell",
  "格子": "Cells",
  "平滑的矢量线条，放大也顺滑": "Smooth vector lines that stay crisp when zoomed",
  "平滑": "Smooth",
  "在线条的起点、终点或两端加箭头": "Add arrows at the start, end or both ends",
  "箭头": "Arrow",
  "线条粗细，单位是当前笔刷格子（[ 和 ] 键调整）": "Line width in brush cells ([ and ] keys)",
  "粗细": "Width",
  "变细": "Thinner",
  "线条粗细（格）": "Line width (cells)",
  "变粗": "Thicker",
  "拖动移动 · 拖右下角缩放": "Drag to move · corner to resize",
  "参考图的不透明度": "Reference image opacity",
  "透明": "Opacity",
  "参考图不透明度": "Reference image opacity",
  "锁定后点击会穿透这张图，可以直接在上面画；框选工具下双击图片可重新选中": "When locked, clicks pass through so you can draw on top; double-click it with Select to pick it again",
  "锁定": "Lock",
  "把这张图放到其他参考图上面": "Bring above other reference images",
  "置顶": "To front",
  "删除这张参考图 (Delete)": "Delete this reference image (Delete)",
  "删除": "Delete",
  "颜色说明": "Color key",
  "收起/展开": "Collapse / expand",
  "收起": "Hide",
  "展开": "Show",
  "添加一个新颜色": "Add a new color",
  "+ 添加颜色": "+ Add color",
  "恢复默认的颜色和说明（不影响已画的格子）": "Restore the default colors and names (drawn cells are kept)",
  "恢复默认": "Reset",
  "点色块改颜色，点文字改说明。改颜色时，画布上用这个颜色的格子会一起变。": "Click a swatch to change its color, or the text to rename it. Changing a color updates every cell that uses it.",
  "图标说明": "Icon key",
  "这里列出关卡里用到的图标，点文字可以改成具体的意思，导出图片时会用这些说明。": "Icons used on this map. Click the text to describe what each one means; exported images use these descriptions.",
  "编辑备注": "Edit note",
  "写点备注，比如：这里放 Boss，二阶段会开门": "Write a note, e.g. Boss here, the door opens in phase two",
  "取消": "Cancel",
  "保存 (Ctrl+Enter)": "Save (Ctrl+Enter)",
  "只导出当前层": "Current level only",
  "每层单独一张（打包成 ZIP）": "One image per level (in a ZIP)",
  "所有楼层拼成一张长图": "All levels in one tall image",
  "范围": "Area",
  "自动裁剪到画了内容的区域": "Crop to the drawn content",
  "当前屏幕看到的范围": "What is on screen now",
  "清晰度": "Resolution",
  "每格 8 像素（小图）": "8 px per cell (small)",
  "每格 16 像素": "16 px per cell",
  "每格 32 像素（推荐）": "32 px per cell (recommended)",
  "每格 64 像素（高清）": "64 px per cell (high)",
  "背景": "Background",
  "浅色（适合打印、贴文档）": "Light (for printing and documents)",
  "深色（和编辑器一样）": "Dark (like the editor)",
  "网格线": "Grid lines",
  "带备注": "Notes",
  "带参考图": "Reference images",
  "颜色说明只列出这一层实际用到的颜色": "Only list colors used on that level",
  "只列出用到的颜色": "Used colors only",
  "每层用同一个范围和比例，导出的图可以叠在一起对照": "Use the same area and scale for every level so the images line up",
  "各层范围对齐": "Align levels",
  "缩小 (-)": "Zoom out (-)",
  "放大 (+)": "Zoom in (+)",
  "回到原点 (0)": "Back to origin (0)",
  "复位": "Reset",
  "左键涂色 · 空格/右键/中键拖拽平移 · 滚轮缩放（放大后笔刷自动变细） · 右侧点颜色或按 1-9 选色": "Left-click paints · Space / right / middle drag pans · Wheel zooms · 1-9 picks a color",
  "切换到英文": "Switch to English",
  "切换语言": "Language",

  // 默认颜色
  "墙体": "Wall",
  "地面": "Floor",
  "草地": "Grass",
  "水域": "Water",
  "岩浆/伤害区": "Lava / damage",
  "出生点": "Spawn",
  "终点/目标": "Goal",
  "敌人": "Enemy",
  "道具/机关": "Item / mechanism",

  // 颜色说明面板
  "点击修改颜色": "Click to change the color",
  "{name} 的颜色": "Color of {name}",
  "说明": "Name",
  "删除这个颜色（已画的格子保留）": "Delete this color (drawn cells stay)",
  "删除 {name}": "Delete {name}",
  "新颜色 {n}": "New color {n}",

  // 楼层
  "已添加{floor}": "Added {floor}",
  "已删除{floor}": "Deleted {floor}",
  "当前": "Current",
  "{floor}：{n} 个格子/图形（PageUp / PageDown 切换）": "{floor}: {n} cells/shapes (PageUp / PageDown to switch)",

  // HUD
  "笔刷: {size}": "Brush: {size}",
  "1 格": "1 cell",
  "{n}×{n} 格": "{n}×{n} cells",
  "1/{n} 格": "1/{n} cell",
  "格子: {x}, {y}": "Cell: {x}, {y}",

  // 提示
  "参考图太大，浏览器存不下，刷新后可能会丢失。请记得导出工程文件保存。": "The reference images are too large for browser storage and may be lost on refresh. Export the project file to keep them.",
  "图形太大：超过 {n} 个格子。请缩小视图（笔刷格子变大）后再画。": "Shape too large: over {n} cells. Zoom out (bigger brush cells) and draw again.",
  "弧线：按下设起点，拖到终点松开": "Arc: press at the start, release at the end",
  "弧线：选择终点": "Arc: choose the end point",
  "弧线：移动鼠标调整弯曲，点击确认（Esc 取消）": "Arc: move to adjust the bend, click to confirm (Esc cancels)",
  "备注：点击空白处添加，点击便签编辑；拖便签或拖圆点可分别移动，连线自动伸缩": "Note: click empty space to add, click a label to edit; drag the label or the dot separately and the line stretches",
  "位置: {x}, {y}": "Position: {x}, {y}",
  "位置: 0 m, 0 m": "Position: 0 m, 0 m",
  "1 格 = {len}": "1 cell = {len}",
  "1 格 = {len}（{px} 像素）": "1 cell = {len} ({px} px)",
  "1 格 =": "1 cell =",
  "长度 {len}": "Length {len}",
  "宽 {w} × 高 {h}": "{w} wide × {h} tall",
  "请输入大于 0 的数字": "Enter a number greater than 0",
  "比例已改为 {scale}": "Scale set to {scale}",
  "一个基础格子（缩放 100% 时的格子）代表的现实长度，会存进工程文件": "Real-world length of one base cell (the cell size at 100% zoom). Saved in the project file",
  "每格代表的米数": "Meters per cell",
  "沿坐标轴显示米数刻度": "Show meter labels along the axes",
  "刻度": "Rulers",
  "从这张图生成 layout…": "Generate layout from this image…",
  "按图片的颜色或线条自动涂格子，先预览再生成": "Fill cells automatically from the image's colors or lines; preview first, then generate",
  "从参考图生成": "Generate from image",
  "画布上是预览，满意再点“生成”": "The canvas shows a preview; click Generate when it looks right",
  "按颜色匹配：每格换成最接近的颜色说明颜色，适合彩色平面图。线稿：深色的地方涂成一种颜色，适合黑白线稿或扫描图": "Match colors: each cell takes the closest color-key color, good for colored plans. Line art: dark areas get one color, good for black-and-white drawings or scans",
  "方式": "Method",
  "按颜色匹配": "Match colors",
  "线稿（深色涂一种颜色）": "Line art (dark → one color)",
  "生成的格子有多大；越小越精细，格子数也越多": "Size of the generated cells; smaller is more detailed but makes more cells",
  "格子大小": "Cell size",
  "图片颜色和颜色说明差多少以内才涂；调大会涂得更多": "How close an image color must be to a key color to be filled; higher fills more",
  "容差": "Tolerance",
  "颜色容差": "Color tolerance",
  "比这个更暗的地方才涂；调大会把浅灰色也算进去": "Only areas darker than this are filled; higher includes light grays",
  "深浅": "Darkness",
  "深浅阈值": "Darkness threshold",
  "涂成": "Fill with",
  "线稿涂成的颜色": "Color for line art",
  "可用颜色": "Colors to use",
  "跳过白色和浅灰色的背景": "Skip white and light gray background",
  "忽略白色背景": "Ignore white background",
  "去掉周围没有同色格子的孤立小点": "Remove isolated cells with no neighbor of the same color",
  "去除杂点": "Remove specks",
  "生成": "Generate",
  "（当前笔刷）": " (current brush)",
  "图片还没加载好，请稍后再试": "The image hasn't loaded yet; try again in a moment",
  "格子太多，请选大一点的格子": "Too many cells; choose a larger cell size",
  "将生成 {n} 个格子，每格 {size}": "Will create {n} cells, {size} each",
  "请至少勾选一种颜色": "Tick at least one color",
  "没有匹配的格子，试试调大容差或换一种方式": "Nothing matched; try a higher tolerance or the other method",
  "已生成 {n} 个格子（Ctrl+Z 可撤销）。可以把参考图调淡或隐藏后检查效果": "Created {n} cells (Ctrl+Z to undo). Fade or hide the reference image to check the result",
  "平面图里常用黑色或深灰色画墙；勾选后这些线条直接涂成颜色说明里的墙体颜色": "Plans often draw walls in black or dark gray; when ticked, those lines become the wall color from the color key",
  "黑色线条算作墙": "Treat black lines as walls",
  "拖动选区移动 · 拖角/边缩放（Shift 保持比例） · 方向键微调 · R 旋转 · Delete 删除 · Esc 取消": "Drag to move · corners/edges to resize (Shift keeps proportions) · arrow keys to nudge · R to rotate · Delete to remove · Esc to cancel",
  "已缩放到 {w} × {h}": "Resized to {w} × {h}",
  "放大后超过 {n} 个格子，请先缩小一些再试。": "Scaling up would exceed {n} cells. Try a smaller size.",
  "拖动选区移动 · 方向键微调 · R 旋转 · Delete 删除 · Esc 取消": "Drag to move · arrow keys to nudge · R to rotate · Delete to remove · Esc to cancel",
  "拖动移动 · 角点缩放 · 圆点旋转": "Drag to move · corner resizes · dot rotates",
  "旋转角度（度），拖图片上方的圆点也能旋转，按住 Shift 每次 15°": "Rotation in degrees. You can also drag the dot above the image; hold Shift for 15° steps",
  "旋转": "Rotate",
  "逆时针旋转 90°": "Rotate 90° counterclockwise",
  "顺时针旋转 90°": "Rotate 90° clockwise",
  "旋转角度": "Rotation angle",
  "选区": "Selection",
  "拖动移动 · R 旋转": "Drag to move · R to rotate",
  "把选中内容旋转 90°（R 顺时针，Shift+R 逆时针）。图标和备注文字保持正向，图标的朝向箭头跟着转": "Rotate the selection by 90° (R clockwise, Shift+R counterclockwise). Icons and note text stay upright; icon facing arrows rotate",
  "拖动选区移动 · 方向键微调 · Delete 删除 · Esc 取消": "Drag to move · arrow keys to nudge · Delete to remove · Esc to cancel",
  "框选：拖出一个框选中内容（Ctrl+A 全选当前层）": "Select: drag a box around content (Ctrl+A selects the whole level)",
  "松开生成；按住 Shift 画正图形": "Release to draw; hold Shift for a regular shape",
  "图形：从一个角拖到对角": "Shape: drag from one corner to the opposite corner",
  "备注还是空的，先写点文字再保存": "The note is empty. Type something before saving.",
  "已删除参考图（可撤销）": "Reference image deleted (undoable)",
  "无法读取这张图片，请换 PNG / JPG / WebP 格式试试。": "Couldn't read that image. Try PNG, JPG or WebP.",
  "已导入参考图：拖动移动，拖四角或四边缩放；调好后勾选“锁定”，就能在上面画了": "Reference image added: drag to move, drag a corner or edge to resize, then tick Lock to draw on top",
  "已锁定：点击会穿透这张图。要再调整，用框选工具双击图片": "Locked: clicks now pass through. Double-click it with Select to adjust it again",
  "自定义图标": "Custom icon",
  "“{name}”图标在这个关卡里代表什么": "What the \"{name}\" icon means on this map",
  "{name} 图标的说明": "Description of the {name} icon",
  "无法读取这些图片，请换 PNG / SVG / JPG / WebP 格式试试。": "Couldn't read those images. Try PNG, SVG, JPG or WebP.",
  "已导入 {n} 个图标，点击画布放置；可以在下面改名字": "Imported {n} icon(s). Click the canvas to place; rename below",
  "已从图标库移除「{name}」（画布上已放的保留）": "Removed \"{name}\" from the library (placed icons stay)",
  "已把选中的 {n} 项改成「{name}」": "Changed {n} selected item(s) to \"{name}\"",
  "已删除 {n} 项": "Deleted {n} item(s)",
  "已选中 {n} 项：拖动移动，点右侧颜色换色，Delete 删除": "{n} item(s) selected: drag to move, pick a color on the right to recolor, Delete to remove",
  "未命名关卡": "Untitled map",
  "上一个保存窗口还没关闭，请稍后再试。": "The previous save prompt is still open. Try again in a moment.",
  "文件太大，请降低清晰度或缩小范围后再试。": "The file is too large. Lower the resolution or the area and try again.",
  "这里无法保存文件，请在浏览器中打开本页面后再导出。": "Files can't be saved here. Open this page in a browser and export again.",
  "已导出 {file}（{n} 层）": "Exported {file} ({n} levels)",
  "将导出「{floor}」一张 PNG。": "Exports one PNG of {floor}.",
  "将导出 {n} 张 PNG（每层一张），打包成一个 ZIP。": "Exports {n} PNGs (one per level) in a ZIP.",
  "将把 {n} 层从上到下拼成一张 PNG，底部是合并的颜色和图标说明。": "Stacks {n} levels top to bottom in one PNG, with a combined key at the bottom.",
  "正在生成…": "Rendering…",
  "全部楼层": "all-levels",
  "楼层图片": "level-images",
  "已导出图片": "Image exported",
  "已导出 {n} 张图片": "Exported {n} images",
  "（跳过 {n} 个空楼层）": " (skipped {n} empty levels)",
  "。内容太大，已自动降低清晰度": ". The content was large, so the resolution was lowered",
  "导出图片失败：{msg}": "Image export failed: {msg}",
  "已导入「{name}」（{n} 层）": "Imported \"{name}\" ({n} levels)",
  "导入失败：{msg}": "Import failed: {msg}",
  "已切换到中文": "已切换到中文",
  "Switched to English": "Switched to English",

  // 工程文件
  "文件不是有效的 JSON。": "The file is not valid JSON.",
  "这不是关卡 Layout 设计器的工程文件。": "This is not a Level Layout Designer project file.",
  "工程文件版本比当前工具新，请使用新版工具打开。": "This project file is from a newer version of the tool.",

  // 导出图片
  "1 格 = {px} 像素": "1 cell = {px} px",

  // 图形和箭头
  "直线": "Line",
  "矩形": "Rectangle",
  "圆/椭圆": "Circle / ellipse",
  "三角形": "Triangle",
  "菱形": "Diamond",
  "六边形": "Hexagon",
  "多边形（自定边数）": "Polygon (custom sides)",
  "无": "None",
  "终点": "End",
  "起点": "Start",
  "两端": "Both",

  // 图标
  "上楼梯": "Stairs up",
  "下楼梯": "Stairs down",
  "梯子": "Ladder",
  "门": "Door",
  "锁着的门": "Locked door",
  "钥匙": "Key",
  "宝箱": "Chest",
  "陷阱": "Trap",
  "记录点": "Save point",
  "Boss": "Boss",
  "NPC/对话": "NPC / talk",
  "商店": "Shop",
  "回复": "Heal",
  "道具": "Item",
  "机关/开关": "Switch / lever",
  "传送点": "Teleporter",
  "危险": "Danger",
  "镜头/视点": "Camera / viewpoint",
  // 导入游戏引擎（版本 5）
  "墙": "Wall",
  "伤害区": "Hazard",
  "标记（不生成）": "Marker (no geometry)",
  "忽略": "Ignore",
  "导入游戏引擎（UE 插件）时，这种颜色生成成什么": "What this color becomes when imported into a game engine (UE plugin)",
  "{name} 在引擎里是": "{name} in the engine",
  "层墙高": "Default",
  "这种颜色的高度（米）。留空 = 用楼层的墙高": "Height of this color in meters. Empty = use the level's wall height",
  "{name} 的高度（米）": "Height of {name} (m)",
  "导入游戏引擎（UE 插件）时这一层的高度，留空用灰色的默认值": "Heights of this level for the game engine import (UE plugin). Leave empty to use the gray default",
  "标高": "Elevation",
  "墙高": "Wall height",
  "当前层标高（米）": "Current level elevation (m)",
  "当前层墙高（米）": "Current level wall height (m)",
};
