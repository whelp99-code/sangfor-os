import { createHash, sign as signDetached, verify as verifyDetached } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const PRODUCTION_AUTHORITY_PATH = "/etc/sangfor-os/production-authority.json";
const DEPLOYMENT_RECEIPT_DOMAIN = "sangfor.production-deployment-receipt/v1";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function assertOwnerOnly(path, allowNonRootOwner) {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${path} must not be a symbolic link`);
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error(`${path} must be an owner-only regular file`);
  if (!allowNonRootOwner && stat.uid !== 0) throw new Error(`${path} must be owned by root`);
}

export function loadProductionAuthority(path = PRODUCTION_AUTHORITY_PATH, { allowNonRootOwner = false } = {}) {
  const authorityPath = resolve(path);
  assertOwnerOnly(authorityPath, allowNonRootOwner);
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  if (authority.schemaVersion !== 1 || typeof authority.approvalIssuer !== "string" || !authority.approvalIssuer) throw new Error("production authority identity invalid");
  if (!authority.approvalKeys || typeof authority.approvalKeys !== "object" || !Object.values(authority.approvalKeys).every((entry) => entry?.status === "verify" && typeof entry.publicKeyPem === "string")) throw new Error("production approval keys missing or invalid");
  let nonceUrl;
  try { nonceUrl = new URL(authority.nonceConsumeUrl); } catch { throw new Error("production nonce consume URL invalid"); }
  if (nonceUrl.protocol !== "https:" || nonceUrl.username || nonceUrl.password || nonceUrl.hash || ["localhost", "127.0.0.1", "::1"].includes(nonceUrl.hostname)) throw new Error("production nonce consume URL must be remote HTTPS without userinfo or fragment");
  if (typeof authority.nonceConsumeBearerToken !== "string" || authority.nonceConsumeBearerToken.length < 32) throw new Error("production nonce consume credential invalid");
  if (typeof authority.deploymentReceiptKeyId !== "string" || !authority.deploymentReceiptKeyId) throw new Error("deployment receipt key ID missing");
  const deploymentReceiptKey = authority.deploymentReceiptKeys?.[authority.deploymentReceiptKeyId];
  if (deploymentReceiptKey?.status !== "verify" || typeof deploymentReceiptKey.publicKeyPem !== "string") throw new Error("deployment receipt verify key missing");
  if (typeof authority.deploymentReceiptPrivateKeyPath !== "string" || !isAbsolute(authority.deploymentReceiptPrivateKeyPath)) throw new Error("deployment receipt private key path must be absolute");
  return { authority, authorityPath };
}

export function deploymentAuthoritySha256(authority, keyId) {
  const deploymentReceiptKey = authority.deploymentReceiptKeys?.[keyId];
  if (deploymentReceiptKey?.status !== "verify" || typeof deploymentReceiptKey.publicKeyPem !== "string") throw new Error("deployment receipt authority key unavailable");
  return createHash("sha256").update(canonicalJson({ schemaVersion: authority.schemaVersion, keyId, deploymentReceiptKey })).digest("hex");
}

function unsignedDeploymentReceipt(receipt) {
  const { signature: _signature, ...unsigned } = receipt;
  return unsigned;
}

export function signDeploymentReceipt(receipt, authority, { allowNonRootOwner = false } = {}) {
  const keyPath = authority.deploymentReceiptPrivateKeyPath;
  assertOwnerOnly(keyPath, allowNonRootOwner);
  const value = signDetached(null, Buffer.from(`${DEPLOYMENT_RECEIPT_DOMAIN}\n${canonicalJson(unsignedDeploymentReceipt(receipt))}`), readFileSync(keyPath)).toString("base64url");
  return { ...receipt, signature: { algorithm: "Ed25519", keyId: authority.deploymentReceiptKeyId, value } };
}

export function verifyDeploymentReceipt(receipt, authority) {
  const signature = receipt?.signature;
  const entry = signature && authority.deploymentReceiptKeys?.[signature.keyId];
  if (!signature || signature.algorithm !== "Ed25519" || entry?.status !== "verify" || typeof entry.publicKeyPem !== "string") throw new Error("deployment receipt signature metadata invalid");
  const supplied = typeof signature.value === "string" && /^[A-Za-z0-9_-]+$/u.test(signature.value) ? Buffer.from(signature.value, "base64url") : Buffer.alloc(0);
  let valid = false;
  try {
    valid = supplied.length === 64 && verifyDetached(null, Buffer.from(`${DEPLOYMENT_RECEIPT_DOMAIN}\n${canonicalJson(unsignedDeploymentReceipt(receipt))}`), entry.publicKeyPem, supplied);
  } catch {
    valid = false;
  }
  if (!valid) throw new Error("deployment receipt signature invalid");
  return receipt;
}

export function preflightDeploymentSigningAuthority(authority, options = {}) {
  const challenge = { schemaVersion: 0, purpose: "production-deployment-signing-preflight" };
  verifyDeploymentReceipt(signDeploymentReceipt(challenge, authority, options), authority);
  return { ok: true, keyId: authority.deploymentReceiptKeyId, authoritySha256: deploymentAuthoritySha256(authority, authority.deploymentReceiptKeyId) };
}
