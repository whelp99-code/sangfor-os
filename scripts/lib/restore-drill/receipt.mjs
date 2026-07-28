import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class ReceiptError extends Error {}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateNode(schema, value, path, errors) {
  if (schema.const !== undefined) {
    if (JSON.stringify(value) !== JSON.stringify(schema.const)) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }
    return;
  }
  if (schema.enum !== undefined) {
    if (!schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
      errors.push(`${path}: value not in enum`);
    }
  }
  if (schema.type === "object") {
    if (!isPlainObject(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required field ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}: unknown field ${key}`);
      }
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateNode(propSchema, value[key], `${path}.${key}`, errors);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path}: expected string`);
      return;
    }
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: expected minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) {
      errors.push(`${path}: expected integer`);
      return;
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path}: expected boolean`);
  }
}

/**
 * Minimal, self-contained JSON Schema (subset) validator: type, const, enum,
 * pattern, minLength, minimum, required, additionalProperties:false,
 * properties, items, minItems. No third-party dependency.
 */
export function validateAgainstSchemaObject(schema, value) {
  const errors = [];
  validateNode(schema, value, "$", errors);
  if (errors.length > 0) {
    throw new ReceiptError(`schema validation failed: ${errors.join("; ")}`);
  }
  return true;
}

export function loadSchema(schemaPath) {
  return JSON.parse(readFileSync(schemaPath, "utf8"));
}

export function validateAgainstSchemaFile(schemaPath, value) {
  return validateAgainstSchemaObject(loadSchema(schemaPath), value);
}

const CREDENTIAL_KEY_RE = /password|secret|databaseurl|connectionstring/i;

export function redactCredentials(value) {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = CREDENTIAL_KEY_RE.test(key) ? "[REDACTED]" : redactCredentials(inner);
    }
    return out;
  }
  if (typeof value === "string" && /^postgresql:\/\/[^/]*:[^/]*@/.test(value)) {
    return value.replace(/:\/\/[^@]*@/, "://[REDACTED]@");
  }
  return value;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Exclusive-create the destination via a fresh sibling temp dir + atomic
 * rename, so no writer can observe a partial file.
 */
export function atomicWriteJson(targetPath, value) {
  if (existsSync(targetPath)) {
    throw new ReceiptError(`refusing to overwrite existing receipt: ${targetPath}`);
  }
  const bytes = canonicalJsonBytes(redactCredentials(value));
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const stagingDir = mkdtempSync(join(dir, ".receipt-"));
  try {
    const stagingFile = join(stagingDir, "receipt.json.tmp");
    writeFileSync(stagingFile, bytes, { flag: "wx" });
    renameSync(stagingFile, targetPath);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
  return { bytes, sha256: sha256Hex(bytes) };
}

export function sidecarPathFor(filePath) {
  return filePath.replace(/\.[^./]+$/, ".sha256");
}

export function writeSha256Sidecar(filePath, sha256) {
  const sidecarPath = sidecarPathFor(filePath);
  writeFileSync(sidecarPath, `${sha256}\n`);
  return sidecarPath;
}
