export type Role = 'admin' | 'manager' | 'user' | 'viewer'

export type Permission = 'read' | 'write' | 'delete' | 'approve' | 'admin'

export type BusinessRole =
  | 'ceo'
  | 'sales_manager'
  | 'account_manager'
  | 'presales_engineer'
  | 'solution_architect'
  | 'finance_manager'
  | 'delivery_engineer'
  | 'support_engineer'
  | 'security_officer'
  | 'system_admin'

export type BusinessPermission =
  | 'customer.read'
  | 'customer.write'
  | 'opportunity.read'
  | 'opportunity.write'
  | 'quote.read'
  | 'quote.write'
  | 'quote.approve_discount'
  | 'poc.read'
  | 'poc.write'
  | 'proposal.read'
  | 'proposal.write'
  | 'sizing.read'
  | 'sizing.write'
  | 'catalog.read'
  | 'catalog.write'
  | 'finance.read'
  | 'finance.write'
  | 'finance.approve_margin'
  | 'delivery.read'
  | 'delivery.write'
  | 'asset.read'
  | 'asset.write'
  | 'support.read'
  | 'support.write'
  | 'support.escalate'
  | 'audit.read'
  | 'role.manage'
  | 'user.manage'
  | 'system.admin'
  | 'restricted_data.read'

export interface AuthScope {
  tenantId: string
  companyId: string
  personaId?: string
  businessRole: BusinessRole
}

export interface AuthContext extends AuthScope {
  userId: string
  sessionId: string | null
  permissions: BusinessPermission[]
  product?: string
}
