export type RevenueApprovalItem = {
  id: string;
  itemType: string;
  status: string;
  ownerRole: string;
  priority: string;
};

export type RevenueApprovalQueueFilter = {
  itemType?: string;
  status?: string;
  ownerRole?: string;
  priority?: string;
};

export function filterRevenueApprovalQueue<T extends RevenueApprovalItem>(
  items: readonly T[],
  filter: RevenueApprovalQueueFilter,
): T[] {
  return items.filter((item) => {
    if (filter.itemType && item.itemType !== filter.itemType) return false;
    if (filter.status && item.status !== filter.status) return false;
    if (filter.ownerRole && item.ownerRole !== filter.ownerRole) return false;
    if (filter.priority && item.priority !== filter.priority) return false;
    return true;
  });
}
