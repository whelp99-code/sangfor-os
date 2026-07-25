export interface CustomerAssetInput {
  id: string;
  customerId: string;
  productName: string;
  serialNo?: string;
  status: "active" | "inactive" | "retired";
  installedAt?: Date;
  warrantyEnd?: Date;
}

export interface PreviewRenewalOpportunity {
  assetId: string;
  customerId: string;
  productName: string;
  estimatedAmount: number;
  status: "pending";
  dueDate: Date;
}

export function previewAssetRenewalThresholds(
  assets: CustomerAssetInput[],
  now: Date,
  daysAhead: number = 30,
): PreviewRenewalOpportunity[] {
  const deadline = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  return assets
    .filter((a) => a.status === "active" && a.warrantyEnd && a.warrantyEnd <= deadline && a.warrantyEnd >= now)
    .map((a) => ({
      assetId: a.id,
      customerId: a.customerId,
      productName: a.productName,
      estimatedAmount: 0,
      status: "pending" as const,
      dueDate: a.warrantyEnd!,
    }));
}

export function generateRenewalReminders(
  assets: CustomerAssetInput[],
  now: Date = new Date(),
  daysAhead: number = 30,
): PreviewRenewalOpportunity[] {
  return previewAssetRenewalThresholds(assets, now, daysAhead);
}
