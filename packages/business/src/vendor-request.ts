export type VendorRequestType = 'deal_registration' | 'special_discount' | 'demo_license' | 'nfr_asset' | 'technical_escalation' | 'partner_portal_request' | 'training_request'

export interface VendorRequest {
  id: string
  opportunityId: string
  requestType: VendorRequestType
  vendorName: string
  details: Record<string, unknown>
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
  createdAt: Date
}

export const SUPPORTED_REQUEST_TYPES: VendorRequestType[] = [
  'deal_registration', 'special_discount', 'demo_license', 'nfr_asset',
  'technical_escalation', 'partner_portal_request', 'training_request',
]

export function validateVendorRequest(requestType: string): boolean {
  return SUPPORTED_REQUEST_TYPES.includes(requestType as VendorRequestType)
}
