// Helpers for the plain JSON data the engine works with.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** JSON with object keys sorted, so equal data always gives the same string. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Deep copy of plain data (objects, arrays and primitives). */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const copy = new Array(value.length)
    for (let i = 0; i < value.length; i++) copy[i] = deepClone(value[i])
    return copy as T
  }
  const copy: Record<string, unknown> = {}
  for (const k in value) copy[k] = deepClone((value as Record<string, unknown>)[k])
  return copy as T
}
