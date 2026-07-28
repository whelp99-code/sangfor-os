import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import * as CanonicalContentHash from './canonical-content-hash';
import {
  ARTIFACT_CONTENT_CONTRACT,
  ARTIFACT_CONTENT_HASH_VERSION,
  CanonicalContentError,
  canonicalizeRfc8785,
  parseCanonicalArtifactContent,
} from './canonical-content-hash';

// Official RFC 8785 (JSON Canonicalization Scheme) reference vectors, fetched verbatim from
// https://github.com/cyberphone/json-canonicalization (the JCS reference implementation's own
// test corpus, testdata/input/*.json -> testdata/output/*.json) so the expected outputs below are
// not hand-derived from this codebase's own understanding of the spec.
const OFFICIAL_VECTORS: Array<{ name: string; input: string; output: string }> = [
  {
    name: 'arrays',
    input: '[\n  56,\n  {\n    "d": true,\n    "10": null,\n    "1": [ ]\n  }\n]\n',
    output: '[56,{"1":[],"10":null,"d":true}]',
  },
  {
    name: 'french',
    input:
      '{\n  "peach": "This sorting order",\n  "péché": "is wrong according to French",\n  "pêche": "but canonicalization MUST",\n  "sin":   "ignore locale"\n}\n',
    output: '{"peach":"This sorting order","péché":"is wrong according to French","pêche":"but canonicalization MUST","sin":"ignore locale"}',
  },
  {
    name: 'structures',
    input: '{\n  "1": {"f": {"f": "hi","F": 5} ,"\\n": 56.0},\n  "10": { },\n  "": "empty",\n  "a": { },\n  "111": [ {"e": "yes","E": "no" } ],\n  "A": { }\n}',
    output: '{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}',
  },
  {
    // The whole point of this vector: JCS must NOT Unicode-normalize. The expected output keeps
    // "A" + COMBINING RING ABOVE (U+0041 U+030A) as two separate code points — it must not become
    // the single precomposed U+00C5 "Å". Written with explicit \u escapes (never a literal typed
    // character) so no editor/tool-chain Unicode normalization can silently corrupt this fixture.
    name: 'unicode',
    input: '{\n  "Unnormalized Unicode":"A\\u030a"\n}\n',
    output: '{"Unnormalized Unicode":"Å"}',
  },
  {
    name: 'values',
    input:
      '{\n  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],\n  "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",\n  "literals": [null, true, false]\n}',
    output: '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  },
  {
    //  and  are both written with explicit \u escapes in the expected OUTPUT (rather
    // than the literal control characters) purely so this source file stays free of raw control
    // bytes; per RFC 8785 neither is escaped in the actual canonical text (only U+0000-U+001F is)
    // — both single  chars below MUST decode to their names, see below.
    name: 'weird',
    input:
      '{\n  "\\u20ac": "Euro Sign",\n  "\\r": "Carriage Return",\n  "\\u000a": "Newline",\n  "1": "One",\n  "\\u0080": "Control\\u007f",\n  "\\ud83d\\ude02": "Smiley",\n  "\\u00f6": "Latin Small Letter O With Diaeresis",\n  "\\ufb33": "Hebrew Letter Dalet With Dagesh",\n  "</script>": "Browser Challenge"\n}\n',
    output:
      '{"\\n":"Newline","\\r":"Carriage Return","1":"One","</script>":"Browser Challenge","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😂":"Smiley","דּ":"Hebrew Letter Dalet With Dagesh"}',
  },
];

describe('canonicalizeRfc8785 — official RFC 8785 reference vectors', () => {
  for (const vector of OFFICIAL_VECTORS) {
    it(`matches the official cyberphone/json-canonicalization "${vector.name}" vector`, () => {
      // JSON.parse is used only here, to build a TRUSTED test fixture value from a known-good
      // official vector — never anywhere in canonical-content-hash.ts's own untrusted-ingress path.
      const value = JSON.parse(vector.input);
      expect(canonicalizeRfc8785(value)).toBe(vector.output);
    });
  }

  it('the "weird" vector proves UTF-16 code-unit key ordering, not full-codepoint ordering: the astral U+1F602 (surrogate pair starting 0xD83D) sorts between U+20AC and the Hebrew U+FB33, even though its full code point is numerically larger than both', () => {
    const value = JSON.parse(OFFICIAL_VECTORS.find((v) => v.name === 'weird')!.input);
    const canonical = canonicalizeRfc8785(value);
    const euroPos = canonical.indexOf('\u20ac');
    const smileyPos = canonical.indexOf('\ud83d\ude02');
    const hebrewPos = canonical.indexOf('\ufb33');
    expect(euroPos).toBeGreaterThan(-1);
    expect(euroPos).toBeLessThan(smileyPos);
    expect(smileyPos).toBeLessThan(hebrewPos);
  });
});

describe('canonicalizeRfc8785 — boundary numeric cases (from the official "values" vector)', () => {
  it('formats -0 as "0"', () => {
    expect(canonicalizeRfc8785(-0)).toBe('0');
    expect(canonicalizeRfc8785(0)).toBe('0');
  });

  it('formats a large exponent as "1e+30"', () => {
    expect(canonicalizeRfc8785(1e30)).toBe('1e+30');
  });

  it('formats a small exponent as "1e-27"', () => {
    expect(canonicalizeRfc8785(1e-27)).toBe('1e-27');
  });

  it('formats 0.002 in fixed notation, not scientific', () => {
    expect(canonicalizeRfc8785(0.002)).toBe('0.002');
  });

  it('drops a trailing zero: 4.50 -> 4.5', () => {
    expect(canonicalizeRfc8785(4.5)).toBe('4.5');
  });

  it('rejects NaN and Infinity as non-finite', () => {
    expect(() => canonicalizeRfc8785(Number.NaN)).toThrow(CanonicalContentError);
    expect(() => canonicalizeRfc8785(Number.POSITIVE_INFINITY)).toThrow(CanonicalContentError);
  });
});

describe('parseCanonicalArtifactContent — envelope/hash construction over a trusted fixture', () => {
  it('produces the fixed contentHashVersion literal, the JCS envelope, and its SHA-256 hex digest', () => {
    const raw = '{"b":2,"a":1}';
    const result = parseCanonicalArtifactContent(raw);
    expect(result.contentJson).toEqual({ b: 2, a: 1 });
    expect(result.contentHashVersion).toBe(ARTIFACT_CONTENT_HASH_VERSION);
    expect(result.contentHashVersion).toBe('artifact-content/rfc8785-jcs-sha256/v1');
    expect(result.canonicalContentEnvelope).toBe(`{"contract":"${ARTIFACT_CONTENT_CONTRACT}","payload":{"a":1,"b":2},"version":1}`);
    const expectedHash = createHash('sha256').update(Buffer.from(result.canonicalContentEnvelope, 'utf8')).digest('hex');
    expect(result.contentHash).toBe(expectedHash);
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a Uint8Array of the same raw UTF-8 bytes and produces an identical result to the string form', () => {
    const raw = '{"b":2,"a":1}';
    const bytes = new TextEncoder().encode(raw);
    const fromString = parseCanonicalArtifactContent(raw);
    const fromBytes = parseCanonicalArtifactContent(bytes);
    expect(fromBytes).toEqual(fromString);
  });

  it('round-trips nested arrays/objects/unicode through the envelope', () => {
    const raw = '{"payload_looking_key":"not the real envelope","list":[1,2,3],"nested":{"z":true,"a":null}}';
    const result = parseCanonicalArtifactContent(raw);
    expect(result.canonicalContentEnvelope).toContain('"list":[1,2,3]');
    expect(result.canonicalContentEnvelope).toContain('"nested":{"a":null,"z":true}');
    expect(result.canonicalContentEnvelope.startsWith(`{"contract":"${ARTIFACT_CONTENT_CONTRACT}","payload":{`)).toBe(true);
    expect(result.canonicalContentEnvelope.endsWith(',"version":1}')).toBe(true);
  });
});

describe('parseCanonicalArtifactContent — raw-ingress-only rejection vectors', () => {
  it('rejects a top-level duplicate object member name', () => {
    expect(() => parseCanonicalArtifactContent('{"a":1,"a":2}')).toThrow(CanonicalContentError);
    try {
      parseCanonicalArtifactContent('{"a":1,"a":2}');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CanonicalContentError);
      expect((err as CanonicalContentError).code).toBe('DUPLICATE_KEY');
    }
  });

  it('rejects a duplicate object member name nested several levels deep', () => {
    const raw = '{"outer":{"inner":{"x":1,"y":2,"x":3}}}';
    expect(() => parseCanonicalArtifactContent(raw)).toThrow(CanonicalContentError);
  });

  it('rejects a duplicate key inside an array of objects', () => {
    const raw = '{"list":[{"k":1},{"k":2,"k":3}]}';
    expect(() => parseCanonicalArtifactContent(raw)).toThrow(CanonicalContentError);
  });

  it('rejects escape-equivalent duplicate names: "a" and "\\u0061" decode to the same string', () => {
    const raw = '{"a":1,"\\u0061":2}';
    let caught: unknown;
    try {
      parseCanonicalArtifactContent(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('DUPLICATE_KEY');
  });

  it('rejects a repeated array-position duplicate name across three occurrences', () => {
    const raw = '{"x":1,"x":2,"x":3}';
    expect(() => parseCanonicalArtifactContent(raw)).toThrow(CanonicalContentError);
  });

  it('rejects a leading UTF-8 byte-order-mark on the Uint8Array path', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
    let caught: unknown;
    try {
      parseCanonicalArtifactContent(withBom);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('BOM');
  });

  it('rejects a leading U+FEFF character on the string path', () => {
    let caught: unknown;
    try {
      parseCanonicalArtifactContent('﻿{"a":1}');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('BOM');
  });

  it('rejects invalid UTF-8 bytes', () => {
    const invalid = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xff, 0xfe, 0x7d]); // {"a":<invalid bytes>}
    let caught: unknown;
    try {
      parseCanonicalArtifactContent(invalid);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('INVALID_UTF8');
  });

  it('rejects a CESU-8-style 3-byte encoding of a lone surrogate code point as invalid UTF-8', () => {
    // ED A0 80 is the 3-byte encoding of U+D800 that strict UTF-8 (RFC 3629) explicitly excludes.
    const cesu8 = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]); // {"a":"<ED A0 80>"}
    let caught: unknown;
    try {
      parseCanonicalArtifactContent(cesu8);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('INVALID_UTF8');
  });

  it('rejects a lone high surrogate produced via \\u escape with no following low surrogate', () => {
    let caught: unknown;
    try {
      parseCanonicalArtifactContent('{"a":"\\ud800"}');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('LONE_SURROGATE');
  });

  it('rejects a lone low surrogate produced via \\u escape with no preceding high surrogate', () => {
    let caught: unknown;
    try {
      parseCanonicalArtifactContent('{"a":"\\udc00"}');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('LONE_SURROGATE');
  });

  it('accepts a correctly paired surrogate escape (U+1F602, the same smiley as the official "weird" vector)', () => {
    const result = parseCanonicalArtifactContent('{"a":"\\ud83d\\ude02"}');
    expect(result.contentJson).toEqual({ a: '😂' });
  });

  it('rejects a JSON number that overflows to a non-finite double (e.g. 1e400)', () => {
    let caught: unknown;
    try {
      parseCanonicalArtifactContent('{"a":1e400}');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('NON_FINITE_NUMBER');
  });

  it('rejects a non-I-JSON number with a leading zero', () => {
    expect(() => parseCanonicalArtifactContent('{"a":01}')).toThrow(CanonicalContentError);
  });

  it('rejects a non-I-JSON number with a leading "+"', () => {
    expect(() => parseCanonicalArtifactContent('{"a":+1}')).toThrow(CanonicalContentError);
  });

  it('rejects trailing tokens after the top-level JSON value', () => {
    let caught: unknown;
    try {
      parseCanonicalArtifactContent('{"a":1} garbage');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('TRAILING_TOKENS');
  });

  it('rejects two concatenated JSON documents as trailing tokens', () => {
    expect(() => parseCanonicalArtifactContent('{"a":1}{"a":2}')).toThrow(CanonicalContentError);
  });

  it('rejects the literals NaN/Infinity as unrecognized tokens (not valid JSON grammar)', () => {
    expect(() => parseCanonicalArtifactContent('{"a":NaN}')).toThrow(CanonicalContentError);
    expect(() => parseCanonicalArtifactContent('{"a":Infinity}')).toThrow(CanonicalContentError);
  });

  it('rejects an unescaped raw control character inside a string', () => {
    expect(() => parseCanonicalArtifactContent('{"a":"line1\nline2"}')).toThrow(CanonicalContentError);
  });

  it('rejects empty input', () => {
    let caught: unknown;
    try {
      parseCanonicalArtifactContent('   ');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CanonicalContentError);
    expect((caught as CanonicalContentError).code).toBe('EMPTY_INPUT');
  });
});

describe('the boundary proof: a parsed/materialized value cannot evidence absent duplicate source keys', () => {
  it('JSON.parse silently collapses duplicate keys (last-write-wins), producing a value indistinguishable from a single-key source', () => {
    // This is exactly the FORBIDDEN "JSON.parse then duplicate-check" shape: by the time you hold
    // `collapsed`, there is no way to recover that the source text had two "a" members.
    const collapsed = JSON.parse('{"a":1,"a":2}');
    const neverHadADuplicate = JSON.parse('{"a":2}');
    expect(collapsed).toEqual(neverHadADuplicate);
    expect(Object.keys(collapsed)).toEqual(['a']);
  });

  it('the same collapse happens for escape-equivalent duplicate names', () => {
    const collapsed = JSON.parse('{"a":1,"\\u0061":2}');
    expect(collapsed).toEqual({ a: 2 });
  });

  it('parseCanonicalArtifactContent, given the exact same raw text, rejects it before any value is built — proving the raw scanner is the only place this can be caught', () => {
    expect(() => parseCanonicalArtifactContent('{"a":1,"a":2}')).toThrow(CanonicalContentError);
    expect(() => parseCanonicalArtifactContent('{"a":1,"\\u0061":2}')).toThrow(CanonicalContentError);
  });
});

describe('module export surface — exact contract', () => {
  it('exports exactly the raw-ingress parser, the low-level canonicalizer, the error type, and the two fixed contract string constants — no internal tokenizer/helper leaks', () => {
    const exported = Object.keys(CanonicalContentHash).sort();
    expect(exported).toEqual(
      ['ARTIFACT_CONTENT_CONTRACT', 'ARTIFACT_CONTENT_HASH_VERSION', 'CanonicalContentError', 'canonicalizeRfc8785', 'parseCanonicalArtifactContent'].sort(),
    );
  });

  it('does not export the trusted in-process value helper', () => {
    expect((CanonicalContentHash as Record<string, unknown>).buildCanonicalEnvelopeFromValue).toBeUndefined();
  });

  it('fixed contract constants match the exact literals the dispatch requires', () => {
    expect(ARTIFACT_CONTENT_CONTRACT).toBe('sangfor.artifact-content');
    expect(ARTIFACT_CONTENT_HASH_VERSION).toBe('artifact-content/rfc8785-jcs-sha256/v1');
  });
});
