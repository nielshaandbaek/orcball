import { type Hex, toColRow } from '@orcball/engine'

// Grass on the pitch (#163): seamless tiles from art/pitch/, one per hex,
// picked from the hex's position so the pitch looks varied but the same on
// every render and reload. A tile whose name ends in "-rare" (a dirt patch)
// comes up about 1 hex in RARE_ONE_IN; the others share the rest.

export type GrassTile = { id: string; href: string; rare: boolean }

/** About 1 hex in this many gets a rare tile. */
export const RARE_ONE_IN = 12

/** The tiles, by file name, from an import.meta.glob of art/pitch/*.png. */
export function grassTiles(files: Record<string, string>): GrassTile[] {
  return Object.entries(files)
    .map(([path, href]) => {
      const name = path.split('/').at(-1)!.replace(/\.png$/, '')
      return { id: `grass-${name}`, href, rare: name.endsWith('-rare') }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** A well-mixed number from a hex's column and row: the same hex always gives the same number. */
function mix(hex: Hex): number {
  const { col, row } = toColRow(hex)
  let x = (Math.imul(col, 374_761_393) + Math.imul(row, 668_265_263)) >>> 0
  x = Math.imul(x ^ (x >>> 13), 1_274_126_177) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/** The tile for a hex, or null without tiles. */
export function tileFor(tiles: readonly GrassTile[], hex: Hex): GrassTile | null {
  const rare = tiles.filter((t) => t.rare)
  const plain = tiles.filter((t) => !t.rare)
  const x = mix(hex)
  if (rare.length > 0 && (plain.length === 0 || x % RARE_ONE_IN === 0)) return rare[(x >>> 8) % rare.length]!
  return plain.length > 0 ? plain[(x >>> 8) % plain.length]! : null
}
