import type { Role, Permission } from './types'

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['read', 'write', 'delete', 'approve', 'admin'],
  manager: ['read', 'write', 'approve'],
  user: ['read', 'write'],
  viewer: ['read'],
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
