import crypto from 'node:crypto'

export class DataEncryptor {
  private algorithm = 'aes-256-gcm' as const
  private secretKey: Buffer

  constructor(secretKey?: string) {
    const raw = secretKey || process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex')
    this.secretKey = Buffer.from(raw, 'hex')
    if (this.secretKey.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (64 hex characters)')
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv(this.algorithm, this.secretKey, iv) as crypto.CipherGCM
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    const combined = Buffer.concat([iv, authTag, encrypted])
    return combined.toString('base64')
  }

  async decrypt(ciphertext: string): Promise<string> {
    const combined = Buffer.from(ciphertext, 'base64')
    const iv = combined.subarray(0, 12)
    const authTag = combined.subarray(12, 28)
    const encrypted = combined.subarray(28)
    const decipher = crypto.createDecipheriv(this.algorithm, this.secretKey, iv) as crypto.DecipherGCM
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf8')
  }
}
