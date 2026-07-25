import { createHash } from "node:crypto";

export class KeysetPaginationError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "KeysetPaginationError";
    this.code = code;
    this.httpStatus = status;
  }
}

export type KeysetParams = {
  first?: number;
  after?: string;
  before?: string;
  query?: string;
  sort?: string;
  direction?: "asc" | "desc";
  filters?: Record<string, unknown>;
};

export type PageInfo = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
};

export type KeysetResult<T> = {
  nodes: T[];
  pageInfo: PageInfo;
  totalCount?: number;
};

export function encodeCursor(collectionName: string, id: string, sortValue: string | number | Date): string {
  const sortStr = sortValue instanceof Date ? sortValue.toISOString() : String(sortValue);
  const payload = `${collectionName}:${id}:${sortStr}`;
  const sig = createHash("sha256").update(payload).digest("hex").slice(0, 8);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function decodeCursor(collectionName: string, cursor: string): { id: string; sortValue: string } {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parts = raw.split(":");
    if (parts.length < 4) throw new Error("Invalid format");
    const [coll, id, sortStr, sig] = [parts[0], parts[1], parts.slice(2, -1).join(":"), parts[parts.length - 1]];
    const expectedSig = createHash("sha256").update(`${coll}:${id}:${sortStr}`).digest("hex").slice(0, 8);
    if (coll !== collectionName || sig !== expectedSig) {
      throw new KeysetPaginationError("cursor_context_mismatch", "Cursor context mismatch or tampered cursor", 400);
    }
    return { id: id!, sortValue: sortStr! };
  } catch (err) {
    if (err instanceof KeysetPaginationError) throw err;
    throw new KeysetPaginationError("cursor_context_mismatch", "Malformed cursor", 400);
  }
}

export function parseKeysetParams(params: KeysetParams, defaultFirst = 50, maxFirst = 100) {
  if (params.after && params.before) {
    throw new KeysetPaginationError("INVALID_CURSOR_PAIR", "Cannot specify both after and before cursors", 400);
  }
  const first = Math.min(Math.max(params.first ?? defaultFirst, 1), maxFirst);
  return { ...params, first };
}
