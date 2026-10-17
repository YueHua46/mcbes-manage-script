/**
 * 物品数据库的统一核对规则（纯函数，不依赖 Script API）。
 *
 * 启动核对、从结构备份还原、实体被意外移除后的抢救、无人在线时实体卸载，
 * 这四条路径都通过 decideSlot() 决定“实体里的物品”和“索引记录”该如何处理，
 * 保证同一种组合在任何路径下得到同一种结果。
 *
 * 基本不变式：
 * - 只有“正常记录 + 类型一致的实体物品”才是对外可见的商品；
 * - 没有记录（或类型对不上）的实体物品只能隔离，绝不能登记为商品；
 * - 残留副本（物品已交付后清理失败留下的）只能清理，绝不能恢复；
 * - 来自结构备份的物品，只要记录在备份之后改写过（rev > 备份序号）或类型不符，就是过期副本。
 */

export type SlotSource =
  /** 启动时实体仍在，实体里的物品是最新的 */
  | { kind: "live" }
  /** 启动时实体缺失，从结构备份还原；seq 为备份写入时的全库写入序号 */
  | { kind: "backup"; seq: number }
  /** 运行期间实体被意外移除，物品是移除前抓取的副本，将放进新实体 */
  | { kind: "rescue" }
  /** 无人在线时实体随区块卸载：只能改记录，不能动实体 */
  | { kind: "unload" };

export interface SlotRecordView {
  quarantined?: boolean;
  staleCopy?: boolean;
  /** 该槽位实体内容最后一次写入时的全库写入序号 */
  rev?: number;
  /** 记录中快照的物品类型，用于和实体物品比对 */
  snapshotTypeId?: string;
}

export type SlotDecision =
  /** 什么都不做（空槽无记录，或卸载期间无需处理） */
  | { kind: "noop" }
  /** 实体物品与正常记录一致：保留物品，记录保持正常（刷新快照） */
  | { kind: "activate" }
  /** 隔离记录 + 实体物品：继续保持隔离 */
  | { kind: "keepQuarantine" }
  /** 记录已无对应物品（隔离或残留记录）：删除记录 */
  | { kind: "dropRecord" }
  /** 残留副本：清掉实体中的物品（如有）并删除记录 */
  | { kind: "clearStaleCopy" }
  /** 实体物品没有记录：保留物品并登记隔离 */
  | { kind: "quarantine"; reason: string }
  /** 实体物品与正常记录类型不符：保留物品并隔离，原记录另存审计 */
  | { kind: "quarantineMismatch"; reason: string }
  /** 备份中的过期副本且该槽位已无记录：丢弃实体物品（留审计） */
  | { kind: "discardBackupCopy"; reason: string }
  /**
   * 正常记录缺少可信的实体物品：按最佳来源重建（抢救时优先用内存中的完整物品，否则用 JSON 快照）。
   * discardEntityItem 为 true 时，先丢弃实体中的过期副本。
   */
  | { kind: "rebuild"; discardEntityItem: boolean; reason: string };

/**
 * @param entityTypeId 实体该槽位物品的类型；undefined 表示空槽
 * @param record 该槽位的索引记录；undefined 表示没有记录
 */
export function decideSlot(
  entityTypeId: string | undefined,
  record: SlotRecordView | undefined,
  source: SlotSource
): SlotDecision {
  const hasItem = entityTypeId !== undefined;

  if (!record) {
    if (!hasItem) return { kind: "noop" };
    if (source.kind === "backup") {
      // 备份时每件实体物品都有记录（正常或隔离）；现在没有，说明它在备份之后被删除了（已交付）。
      return { kind: "discardBackupCopy", reason: "item was removed after the structure backup" };
    }
    return { kind: "quarantine", reason: `entity item without index (${source.kind})` };
  }

  if (record.staleCopy) {
    if (source.kind === "unload") return { kind: "noop" };
    return { kind: "clearStaleCopy" };
  }

  if (record.quarantined) {
    if (!hasItem) return source.kind === "unload" ? { kind: "noop" } : { kind: "dropRecord" };
    return { kind: "keepQuarantine" };
  }

  // 正常记录
  if (!hasItem) {
    if (source.kind === "unload") return { kind: "noop" };
    return { kind: "rebuild", discardEntityItem: false, reason: "slot index exists but entity item is missing" };
  }

  const typeMismatch = record.snapshotTypeId !== undefined && record.snapshotTypeId !== entityTypeId;

  if (source.kind === "backup") {
    if ((record.rev ?? 0) > source.seq || typeMismatch) {
      return { kind: "rebuild", discardEntityItem: true, reason: "slot was rewritten after the structure backup" };
    }
    return { kind: "activate" };
  }

  if (typeMismatch) {
    if (source.kind === "unload") return { kind: "noop" };
    return { kind: "quarantineMismatch", reason: `entity item type does not match slot index (${source.kind})` };
  }

  return source.kind === "unload" ? { kind: "noop" } : { kind: "activate" };
}
