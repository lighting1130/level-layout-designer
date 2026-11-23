/**
 * 给游戏引擎导入用的信息（工程文件 version 5）：颜色说明的“引擎角色”、楼层标高和墙高、图标朝向。
 * 网页本身不用这些信息画图，只负责编辑和导出；UE 导入插件按它们生成白盒。
 */
import { t } from "./i18n";

export type EngineRole = "wall" | "floor" | "water" | "hazard" | "marker" | "none";
export const ENGINE_ROLES: EngineRole[] = ["wall", "floor", "water", "hazard", "marker", "none"];
export const ROLE_LABELS: Record<EngineRole, string> = {
  wall: "墙",
  floor: "地面",
  water: "水域",
  hazard: "伤害区",
  marker: "标记（不生成）",
  none: "忽略",
};
export const isEngineRole = (r: unknown): r is EngineRole => typeof r === "string" && (ENGINE_ROLES as string[]).includes(r);

/** 引擎里的默认尺寸（米），和 UE 导入插件一致：第三人称动作 RPG */
export const DEFAULT_WALL_HEIGHT = 4;
export const DEFAULT_FLOOR_HEIGHT = 5;

/** 按颜色说明的名字猜角色（旧文件没有 role 时使用，和 UE 插件的默认映射一致） */
const NAME_ROLES: Record<string, EngineRole> = {
  "墙体": "wall", "墙": "wall", "wall": "wall", "walls": "wall",
  "地面": "floor", "草地": "floor", "floor": "floor", "ground": "floor", "grass": "floor",
  "水域": "water", "水": "water", "water": "water",
  "岩浆/伤害区": "hazard", "岩浆": "hazard", "伤害区": "hazard", "lava": "hazard", "hazard": "hazard",
  "lava/hazard": "hazard", "lava / hazard": "hazard", "damage": "hazard",
};
export function guessRole(name: string): EngineRole {
  const n = name.trim();
  return NAME_ROLES[n] ?? NAME_ROLES[n.toLowerCase()] ?? "marker";
}

/** 楼层的默认标高（米）：第一层 0，往上每层加层高，负一层在 -层高 */
export const defaultElevation = (level: number) => (level > 0 ? level - 1 : level) * DEFAULT_FLOOR_HEIGHT;

/** 合法的米数（可为负，用于标高）；不合法返回 undefined */
export function parseMeters(v: unknown, allowNegative: boolean): number | undefined {
  if (typeof v === "string") { if (!v.trim()) return undefined; v = Number(v); }
  if (typeof v !== "number" || !isFinite(v)) return undefined;
  if (!allowNegative && v <= 0) return undefined;
  return Math.max(-1e5, Math.min(1e5, Math.round(v * 1000) / 1000));
}

export const roleLabel = (r: EngineRole) => t(ROLE_LABELS[r]);

/** 朝向有意义的图标：画一个小箭头表示朝向（rot，顺时针角度，0 = 朝右 = UE 的 +X） */
export const ORIENTED_ICONS = new Set(["spawn", "camera", "door", "locked", "stairs-up", "stairs-down", "ladder", "enemy", "boss", "npc"]);
