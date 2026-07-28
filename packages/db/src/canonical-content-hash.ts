/**
 * U017/ART-01a — the SOLE JavaScript producer/verifier of the Artifact content-hash contract.
 *
 * `parseCanonicalArtifactContent` is the only untrusted-content ingress: it accepts RAW JSON
 * bytes/text and performs a hand-written, single-pass recursive-descent scan that validates and
 * *constructs* the value in the same pass — it never calls `JSON.parse` (or `Request.json()`,
 * `JSON.stringify`, or any parse-then-check pattern) anywhere near untrusted input, because a
 * JS-value-based duplicate check runs strictly AFTER `JSON.parse` has already silently collapsed
 * duplicate object member names (last-write-wins) — by the time you hold the resulting object,
 * there is no way to tell whether the source text had one key or five. The scanner therefore
 * rejects: a byte-order mark, invalid UTF-8, duplicate decoded object member names at any nesting
 * depth (including escape-equivalent names such as `"a"` and `"a"`, which decode to the same
 * string), lone UTF-16 surrogates, non-I-JSON/non-finite numbers, and trailing tokens — all BEFORE
 * the raw text is converted into a JS value.
 *
 * `canonicalizeRfc8785` is the tested low-level RFC 8785 (JSON Canonicalization Scheme, JCS)
 * canonicalizer: object member names sorted by UTF-16 code unit (JS's default `Array#sort` on
 * strings already does exactly this — no locale collation, ever), numbers serialized via the
 * native ECMAScript `Number::toString` algorithm (`String(n)`, which the language already computes
 * per spec — this is precisely why JCS mandates "ECMAScript compliant" number serialization), and
 * strings escaped per the JCS/`JSON.stringify` quoting rules, reimplemented by hand here (not by
 * calling `JSON.stringify`, which is forbidden at this boundary and does not sort keys anyway).
 *
 * A third, NON-exported helper (`buildCanonicalEnvelopeFromValue`) builds the envelope/hash from
 * an already-validated in-process JS value; it is only ever invoked internally, after the raw
 * scanner above has already produced a duplicate-free value. It exists because a value that is
 * already a materialized JS object structurally cannot carry duplicate keys — this is the "later
 * in-process value can't evidence duplicates" boundary the raw scanner exists to sit in front of.
 */

import { createHash } from 'node:crypto';

export const ARTIFACT_CONTENT_CONTRACT = 'sangfor.artifact-content';
export const ARTIFACT_CONTENT_HASH_VERSION = 'artifact-content/rfc8785-jcs-sha256/v1';

export type CanonicalContentErrorCode =
  | 'BOM'
  | 'INVALID_UTF8'
  | 'DUPLICATE_KEY'
  | 'LONE_SURROGATE'
  | 'NON_FINITE_NUMBER'
  | 'INVALID_NUMBER'
  | 'INVALID_STRING'
  | 'SYNTAX'
  | 'TRAILING_TOKENS'
  | 'EMPTY_INPUT';

export class CanonicalContentError extends Error {
  code: CanonicalContentErrorCode;
  constructor(code: CanonicalContentErrorCode, message: string) {
    super(message);
    this.name = 'CanonicalContentError';
    this.code = code;
  }
}

export interface ParsedCanonicalArtifactContent {
  contentJson: unknown;
  contentHashVersion: string;
  canonicalContentEnvelope: string;
  contentHash: string;
}

// ───────────────────────────────────────────────────────────────────────────
// RFC 8785 JCS canonicalizer (operates on an already-materialized JS value).
// ───────────────────────────────────────────────────────────────────────────

/** Escapes a string per RFC 8785 §3.2.2.2 (identical to the ES `JSON.stringify` quote()
 * algorithm, reimplemented by hand — `JSON.stringify` itself is forbidden at this boundary).
 * Named escapes for backspace/tab/LF/FF/CR/quote/backslash; `\u00XX` for every other control
 * character (U+0000-U+001F); every other UTF-16 code unit (including astral surrogate pairs,
 * U+2028/U+2029, and all non-ASCII text) is emitted literally, unescaped. */
function escapeJcsString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const code = s.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0a) out += '\\n';
    else if (code === 0x0c) out += '\\f';
    else if (code === 0x0d) out += '\\r';
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return `${out}"`;
}

/** ECMAScript Number::toString(x, 10) is exactly RFC 8785's required number serialization — the
 * language already implements the correctly-rounded shortest-round-trip algorithm the spec
 * describes, so `String(n)` (not a custom formatter) is the compliant implementation. `+0`/`-0`
 * both stringify to `"0"` per the same spec clause, so no special-casing is needed here. */
function numberToJcs(n: number): string {
  if (!Number.isFinite(n)) {
    throw new CanonicalContentError('NON_FINITE_NUMBER', `cannot canonicalize a non-finite number: ${n}`);
  }
  return String(n);
}

function canon(value: unknown): string {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return numberToJcs(value);
  if (typeof value === 'string') return escapeJcsString(value);
  if (Array.isArray(value)) return `[${value.map((el) => canon(el)).join(',')}]`;
  if (typeof value === 'object') {
    // Default `Array#sort()` compares elements as strings using the "<" relational string
    // comparison, which the spec defines as element-by-element UTF-16 code unit comparison — this
    // is exactly RFC 8785's required ordering (never locale/collation-aware), including the
    // subtlety that an astral character's leading (high) surrogate code unit (0xD800-0xDBFF)
    // sorts BEFORE any BMP character in 0xE000-0xFFFF, even though its full Unicode code point is
    // numerically larger.
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const members = keys.map((k) => `${escapeJcsString(k)}:${canon((value as Record<string, unknown>)[k])}`);
    return `{${members.join(',')}}`;
  }
  throw new CanonicalContentError('SYNTAX', `canonicalizeRfc8785: unsupported value type ${typeof value}`);
}

/** The tested low-level RFC 8785 (JCS) canonicalizer. Accepts any already-materialized,
 * JSON-representable JS value (objects/arrays/strings/finite numbers/booleans/null) and returns
 * its canonical JCS text. Exported directly so it can be tested against the RFC 8785 official
 * reference vectors independent of the raw-ingress parser below. */
export function canonicalizeRfc8785(value: unknown): string {
  return canon(value);
}

// ───────────────────────────────────────────────────────────────────────────
// Raw-ingress recursive-descent JSON scanner (the untrusted boundary).
// ───────────────────────────────────────────────────────────────────────────

const WS = new Set([' ', '\t', '\n', '\r']);

class Cursor {
  pos = 0;
  constructor(public text: string) {}
  peek(): string | undefined {
    return this.text[this.pos];
  }
  eof(): boolean {
    return this.pos >= this.text.length;
  }
}

function skipWs(cur: Cursor) {
  while (!cur.eof() && WS.has(cur.text[cur.pos]!)) cur.pos++;
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

/** Scans for any UTF-16 code unit in a lone (unpaired) surrogate position: a high surrogate
 * (0xD800-0xDBFF) not immediately followed by a low surrogate (0xDC00-0xDFFF), or a low surrogate
 * that was not just consumed as the second half of a pair. Applies uniformly regardless of
 * whether the surrogate arrived via a `\uXXXX` escape or a raw (already UTF-8-decoded) character —
 * a raw invalid-UTF-8 byte sequence encoding a surrogate code point is rejected earlier, during
 * UTF-8 decode itself (see `decodeInput`), before this function ever runs. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function parseString(cur: Cursor): string {
  cur.pos++;
  let out = '';
  for (;;) {
    if (cur.eof()) throw new CanonicalContentError('SYNTAX', 'unterminated string literal');
    const ch = cur.text[cur.pos]!;
    if (ch === '"') {
      cur.pos++;
      break;
    }
    if (ch === '\\') {
      cur.pos++;
      if (cur.eof()) throw new CanonicalContentError('SYNTAX', 'unterminated escape sequence');
      const esc = cur.text[cur.pos]!;
      if (esc === '"') {
        out += '"';
        cur.pos++;
      } else if (esc === '\\') {
        out += '\\';
        cur.pos++;
      } else if (esc === '/') {
        out += '/';
        cur.pos++;
      } else if (esc === 'b') {
        out += '\b';
        cur.pos++;
      } else if (esc === 'f') {
        out += '\f';
        cur.pos++;
      } else if (esc === 'n') {
        out += '\n';
        cur.pos++;
      } else if (esc === 'r') {
        out += '\r';
        cur.pos++;
      } else if (esc === 't') {
        out += '\t';
        cur.pos++;
      } else if (esc === 'u') {
        cur.pos++;
        const hex = cur.text.slice(cur.pos, cur.pos + 4);
        if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new CanonicalContentError('INVALID_STRING', `invalid \\u escape at position ${cur.pos}`);
        }
        out += String.fromCharCode(parseInt(hex, 16));
        cur.pos += 4;
      } else {
        throw new CanonicalContentError('INVALID_STRING', `invalid escape character "\\${esc}" at position ${cur.pos}`);
      }
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code <= 0x1f) {
      throw new CanonicalContentError('INVALID_STRING', `unescaped control character 0x${code.toString(16).padStart(2, '0')} in string at position ${cur.pos}`);
    }
    out += ch;
    cur.pos++;
  }
  if (hasLoneSurrogate(out)) {
    throw new CanonicalContentError('LONE_SURROGATE', 'string contains an unpaired UTF-16 surrogate code unit');
  }
  return out;
}

function parseNumber(cur: Cursor): number {
  const start = cur.pos;
  if (cur.peek() === '-') cur.pos++;
  if (cur.peek() === '0') {
    cur.pos++;
  } else if (isDigit(cur.peek())) {
    while (isDigit(cur.peek())) cur.pos++;
  } else {
    throw new CanonicalContentError('INVALID_NUMBER', `invalid number literal at position ${start}`);
  }
  if (cur.peek() === '.') {
    cur.pos++;
    if (!isDigit(cur.peek())) throw new CanonicalContentError('INVALID_NUMBER', `expected digit after decimal point at position ${cur.pos}`);
    while (isDigit(cur.peek())) cur.pos++;
  }
  if (cur.peek() === 'e' || cur.peek() === 'E') {
    cur.pos++;
    if (cur.peek() === '+' || cur.peek() === '-') cur.pos++;
    if (!isDigit(cur.peek())) throw new CanonicalContentError('INVALID_NUMBER', `expected digit in exponent at position ${cur.pos}`);
    while (isDigit(cur.peek())) cur.pos++;
  }
  const token = cur.text.slice(start, cur.pos);
  const num = Number(token);
  if (!Number.isFinite(num)) {
    throw new CanonicalContentError('NON_FINITE_NUMBER', `number token "${token}" does not represent a finite IEEE 754 double (overflow)`);
  }
  return num;
}

function parseObject(cur: Cursor): Record<string, unknown> {
  cur.pos++;
  const map = new Map<string, unknown>();
  skipWs(cur);
  if (cur.peek() === '}') {
    cur.pos++;
    return {};
  }
  for (;;) {
    skipWs(cur);
    if (cur.peek() !== '"') throw new CanonicalContentError('SYNTAX', `expected object member name (string) at position ${cur.pos}`);
    const key = parseString(cur);
    if (map.has(key)) {
      throw new CanonicalContentError('DUPLICATE_KEY', `duplicate object member name ${JSON.stringify(key)} — decoded names must be unique at every nesting depth, including escape-equivalent spellings`);
    }
    skipWs(cur);
    if (cur.peek() !== ':') throw new CanonicalContentError('SYNTAX', `expected ':' at position ${cur.pos}`);
    cur.pos++;
    skipWs(cur);
    const value = parseValue(cur);
    map.set(key, value);
    skipWs(cur);
    const c = cur.peek();
    if (c === ',') {
      cur.pos++;
      continue;
    }
    if (c === '}') {
      cur.pos++;
      break;
    }
    throw new CanonicalContentError('SYNTAX', `expected ',' or '}' at position ${cur.pos}`);
  }
  // Object.fromEntries uses CreateDataPropertyOrThrow (define-property) semantics, not bracket
  // assignment — a decoded key literally named "__proto__" becomes a normal own data property
  // instead of silently reassigning the object's prototype (no prototype-pollution hazard from
  // untrusted key names).
  return Object.fromEntries(map);
}

function parseArray(cur: Cursor): unknown[] {
  cur.pos++;
  const out: unknown[] = [];
  skipWs(cur);
  if (cur.peek() === ']') {
    cur.pos++;
    return out;
  }
  for (;;) {
    skipWs(cur);
    out.push(parseValue(cur));
    skipWs(cur);
    const c = cur.peek();
    if (c === ',') {
      cur.pos++;
      continue;
    }
    if (c === ']') {
      cur.pos++;
      break;
    }
    throw new CanonicalContentError('SYNTAX', `expected ',' or ']' at position ${cur.pos}`);
  }
  return out;
}

function parseValue(cur: Cursor): unknown {
  skipWs(cur);
  if (cur.eof()) throw new CanonicalContentError('SYNTAX', 'unexpected end of input');
  const ch = cur.text[cur.pos]!;
  if (ch === '{') return parseObject(cur);
  if (ch === '[') return parseArray(cur);
  if (ch === '"') return parseString(cur);
  if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber(cur);
  if (cur.text.startsWith('true', cur.pos)) {
    cur.pos += 4;
    return true;
  }
  if (cur.text.startsWith('false', cur.pos)) {
    cur.pos += 5;
    return false;
  }
  if (cur.text.startsWith('null', cur.pos)) {
    cur.pos += 4;
    return null;
  }
  throw new CanonicalContentError('SYNTAX', `unexpected token at position ${cur.pos}: ${JSON.stringify(ch)}`);
}

function decodeInput(rawJson: string | Uint8Array): string {
  if (typeof rawJson === 'string') {
    if (rawJson.charCodeAt(0) === 0xfeff) {
      throw new CanonicalContentError('BOM', 'input begins with a U+FEFF byte-order-mark character');
    }
    return rawJson;
  }
  if (rawJson.length >= 3 && rawJson[0] === 0xef && rawJson[1] === 0xbb && rawJson[2] === 0xbf) {
    throw new CanonicalContentError('BOM', 'input bytes begin with a UTF-8 byte-order-mark (EF BB BF)');
  }
  let text: string;
  try {
    // fatal: true rejects invalid UTF-8, including CESU-8-style 3-byte encodings of a surrogate
    // code point (RFC 3629 explicitly excludes D800-DFFF from valid UTF-8).
    text = new TextDecoder('utf-8', { fatal: true }).decode(rawJson);
  } catch (err) {
    throw new CanonicalContentError('INVALID_UTF8', `input bytes are not valid UTF-8: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) {
    throw new CanonicalContentError('BOM', 'decoded input begins with a U+FEFF byte-order-mark character');
  }
  return text;
}

/** NON-exported "trusted in-process value helper" — builds the envelope/hash from an
 * already-validated JS value. Used only internally, immediately after the raw scanner above has
 * finished (i.e. only ever after schema/duplicate validation has already happened). A JS value
 * that has already been materialized cannot itself carry duplicate object keys (a plain object
 * cannot have two properties with the same name), which is exactly why this half of the contract
 * must never be reachable directly from untrusted raw text. */
function buildCanonicalEnvelopeFromValue(payload: unknown): { contentHashVersion: string; canonicalContentEnvelope: string; contentHash: string } {
  const envelopeValue = { contract: ARTIFACT_CONTENT_CONTRACT, payload, version: 1 };
  const canonicalContentEnvelope = canonicalizeRfc8785(envelopeValue);
  const bytes = new TextEncoder().encode(canonicalContentEnvelope);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  return { contentHashVersion: ARTIFACT_CONTENT_HASH_VERSION, canonicalContentEnvelope, contentHash };
}

/**
 * The sole untrusted-content ingress. Accepts raw JSON bytes (`Uint8Array`) or text (`string`),
 * validates it with the raw-token scanner above (BOM/UTF-8/duplicate-key/lone-surrogate/
 * non-finite-number/trailing-token rejection happens strictly before any JS value exists), then
 * builds the RFC 8785 JCS envelope `{"contract":"sangfor.artifact-content","payload":<contentJson>,
 * "version":1}` and its SHA-256 content hash.
 */
export function parseCanonicalArtifactContent(rawJson: string | Uint8Array): ParsedCanonicalArtifactContent {
  const text = decodeInput(rawJson);
  const cur = new Cursor(text);
  skipWs(cur);
  if (cur.eof()) throw new CanonicalContentError('EMPTY_INPUT', 'input contains no JSON value');
  const value = parseValue(cur);
  skipWs(cur);
  if (!cur.eof()) {
    throw new CanonicalContentError('TRAILING_TOKENS', `unexpected trailing content after the top-level JSON value at position ${cur.pos}`);
  }
  const built = buildCanonicalEnvelopeFromValue(value);
  return { contentJson: value, ...built };
}
