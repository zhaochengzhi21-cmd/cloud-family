/**
 * Deterministic JSON canonicalization for value fingerprints.
 * Object key order must not affect the fingerprint.
 */

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = sortKeysDeep(obj[k]);
    }
    return out;
  }
  return value;
}
