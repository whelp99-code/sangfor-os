import { describe, expect, it } from 'vitest'
import { ApiKeyManager } from './api-keys'

describe('ApiKeyManager', () => {
  it('validates keys registered from existing secrets', () => {
    const manager = new ApiKeyManager()

    manager.registerKey('known-secret', 'finance', 'manager')

    expect(manager.validateKey('known-secret')).toEqual({
      name: 'finance',
      role: 'manager',
    })
    expect(manager.validateKey('other-secret')).toBeNull()
  })
})
