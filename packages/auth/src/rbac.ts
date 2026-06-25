import type { Role, Permission, BusinessRole, BusinessPermission } from './types'

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['read', 'write', 'delete', 'approve', 'admin'],
  manager: ['read', 'write', 'approve'],
  user: ['read', 'write'],
  viewer: ['read'],
}

const BUSINESS_ROLE_PERMISSIONS: Record<BusinessRole, BusinessPermission[]> = {
  ceo: [
    'customer.read', 'customer.write',
    'opportunity.read', 'opportunity.write',
    'quote.read', 'quote.write', 'quote.approve_discount',
    'poc.read', 'poc.write',
    'proposal.read', 'proposal.write',
    'sizing.read', 'sizing.write',
    'catalog.read', 'catalog.write',
    'finance.read', 'finance.write', 'finance.approve_margin',
    'delivery.read', 'delivery.write',
    'asset.read', 'asset.write',
    'support.read', 'support.write', 'support.escalate',
    'audit.read', 'role.manage', 'user.manage',
    'system.admin', 'restricted_data.read',
  ],
  sales_manager: [
    'customer.read', 'customer.write',
    'opportunity.read', 'opportunity.write',
    'quote.read', 'quote.write', 'quote.approve_discount',
  ],
  account_manager: [
    'customer.read',
    'opportunity.read',
  ],
  presales_engineer: [
    'opportunity.read',
    'poc.read', 'poc.write',
    'proposal.read', 'proposal.write',
  ],
  solution_architect: [
    'sizing.read', 'sizing.write',
    'catalog.read', 'catalog.write',
  ],
  finance_manager: [
    'quote.read', 'quote.write',
    'finance.read', 'finance.write', 'finance.approve_margin',
  ],
  delivery_engineer: [
    'delivery.read', 'delivery.write',
    'asset.read', 'asset.write',
  ],
  support_engineer: [
    'support.read', 'support.write', 'support.escalate',
  ],
  security_officer: [
    'audit.read',
    'role.manage',
    'restricted_data.read',
  ],
  system_admin: [
    'system.admin',
    'user.manage',
  ],
}

export class RBAC {
  hasPermission(role: Role, permission: Permission): boolean {
    const permissions = ROLE_PERMISSIONS[role]
    if (!permissions) return false
    return permissions.includes(permission)
  }

  requirePermission(role: Role, permission: Permission): void {
    if (!this.hasPermission(role, permission)) {
      throw new Error(`Access denied: role "${role}" does not have permission "${permission}"`)
    }
  }

  getRolePermissions(role: Role): Permission[] {
    return [...(ROLE_PERMISSIONS[role] || [])]
  }
}

export class BusinessRBAC {
  hasPermission(role: BusinessRole, permission: BusinessPermission): boolean {
    const permissions = BUSINESS_ROLE_PERMISSIONS[role]
    if (!permissions) return false
    return permissions.includes(permission)
  }

  requirePermission(role: BusinessRole, permission: BusinessPermission): void {
    if (!this.hasPermission(role, permission)) {
      throw new Error(`Access denied: business role "${role}" does not have permission "${permission}"`)
    }
  }

  getRolePermissions(role: BusinessRole): BusinessPermission[] {
    return [...(BUSINESS_ROLE_PERMISSIONS[role] || [])]
  }

  hasAnyPermission(role: BusinessRole, permissions: BusinessPermission[]): boolean {
    return permissions.some((p) => this.hasPermission(role, p))
  }

  getAllPermissions(): Record<BusinessRole, BusinessPermission[]> {
    return { ...BUSINESS_ROLE_PERMISSIONS }
  }
}
