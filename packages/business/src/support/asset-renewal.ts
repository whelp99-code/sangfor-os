export interface CustomerAsset {
  id: string
  customerId: string
  productName: string
  serialNo?: string
  status: 'active' | 'inactive' | 'retired'
  installedAt?: Date
  warrantyEnd?: Date
}

export interface RenewalOpportunity {
  id: string
  assetId: string
  customerId: string
  productName: string
  estimatedAmount: number
  status: 'pending' | 'in_progress' | 'completed' | 'lost'
  dueDate: Date
}

export function generateRenewalReminders(assets: CustomerAsset[], daysAhead: number = 30): RenewalOpportunity[] {
  const now = new Date()
  const deadline = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  return assets
    .filter(a => a.status === 'active' && a.warrantyEnd && a.warrantyEnd <= deadline && a.warrantyEnd >= now)
    .map(a => ({
      id: `renewal-${a.id}-${Date.now()}`,
      assetId: a.id,
      customerId: a.customerId,
      productName: a.productName,
      estimatedAmount: 0,
      status: 'pending' as const,
      dueDate: a.warrantyEnd!,
    }))
}
