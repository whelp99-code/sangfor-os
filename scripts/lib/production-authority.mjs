import { createHash, sign as signDetached, verify as verifyDetached } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
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

function parseIpv4(address) {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function parseIpv6(address) {
  if (isIP(address) !== 6) return null;
  let normalized = address;
  const ipv4Start = normalized.lastIndexOf(":") + 1;
  const ipv4 = parseIpv4(normalized.slice(ipv4Start));
  if (ipv4) {
    normalized = `${normalized.slice(0, ipv4Start)}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || (halves.length === 2 && omitted < 1)) return null;
  const groups = [...left, ...Array(omitted).fill("0"), ...right].map((group) => Number.parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function isDeniedIpv4(bytes) {
  return bytes[0] === 0
    || bytes[0] === 10
    || bytes[0] === 127
    || (bytes[0] === 169 && bytes[1] === 254)
    || (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31)
    || (bytes[0] === 192 && bytes[1] === 168);
}

function isDeniedNonceHost(hostname) {
  const unbracketed = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const ipv4 = parseIpv4(unbracketed);
  if (ipv4) return isDeniedIpv4(ipv4);
  const ipv6 = parseIpv6(unbracketed);
  if (ipv6) {
    const unspecifiedOrLoopback = ipv6.slice(0, 7).every((group) => group === 0) && (ipv6[7] === 0 || ipv6[7] === 1);
    const linkLocal = (ipv6[0] & 0xffc0) === 0xfe80;
    const uniqueLocal = (ipv6[0] & 0xfe00) === 0xfc00;
    const ipv4Mapped = ipv6.slice(0, 5).every((group) => group === 0) && ipv6[5] === 0xffff;
    const mappedIpv4 = [(ipv6[6] >> 8) & 0xff, ipv6[6] & 0xff, (ipv6[7] >> 8) & 0xff, ipv6[7] & 0xff];
    return unspecifiedOrLoopback || linkLocal || uniqueLocal || (ipv4Mapped && isDeniedIpv4(mappedIpv4));
  }
  const dnsName = hostname.toLowerCase().replace(/\.+$/u, "");
  return dnsName === "localhost" || dnsName.endsWith(".localhost");
}

export function loadProductionAuthority(path = PRODUCTION_AUTHORITY_PATH, { allowNonRootOwner = false } = {}) {
  const authorityPath = resolve(path);
  assertOwnerOnly(authorityPath, allowNonRootOwner);
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  if (authority.schemaVersion !== 1 || typeof authority.approvalIssuer !== "string" || !authority.approvalIssuer) throw new Error("production authority identity invalid");
  if (!authority.approvalKeys || typeof authority.approvalKeys !== "object" || !Object.values(authority.approvalKeys).every((entry) => entry?.status === "verify" && typeof entry.publicKeyPem === "string")) throw new Error("production approval keys missing or invalid");
  let nonceUrl;
  try { nonceUrl = new URL(authority.nonceConsumeUrl); } catch { throw new Error("production nonce consume URL invalid"); }
  if (nonceUrl.protocol !== "https:" || nonceUrl.username || nonceUrl.password || nonceUrl.hash || isDeniedNonceHost(nonceUrl.hostname)) throw new Error("production nonce consume URL must be remote HTTPS without userinfo or fragment");
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
