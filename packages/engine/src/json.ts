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
  if (Array.isArray(value)) return value.map(deepClone) as T
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) copy[k] = deepClone(v)
    return copy as T
  }
  return value
}
