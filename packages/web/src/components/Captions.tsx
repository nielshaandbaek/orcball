import { useEffect, useRef, useState } from 'react'
import { captionText, type Flash, FLASH_MS } from '../captions'
import { BOARD_HEIGHT, BOARD_WIDTH, HEX_SIZE, hexCenter } from '../geometry'
import { useMatch } from '../store'

/** Where a label goes over a hex: above the player's head, in % of the board. */
function over(hex: Parameters<typeof hexCenter>[0]): { left: string; top: string } {
  const { x, y } = hexCenter(hex)
  return { left: `${(x / BOARD_WIDTH) * 100}%`, top: `${((y - HEX_SIZE * 1.15) / BOARD_HEIGHT) * 100}%` }
}

/** Each flash for FLASH_MS after the command that set it off. */
function useFlashes(flashes: readonly (Flash & { id: number })[]): (Flash & { id: number })[] {
  const [showing, setShowing] = useState<(Flash & { id: number })[]>([])
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    if (flashes.length === 0) return
    const ids = new Set(flashes.map((f) => f.id))
    setShowing((s) => [...s.filter((f) => !flashes.some((n) => n.playerId === f.playerId)), ...flashes])
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setShowing((s) => s.filter((f) => !ids.has(f.id)))
    }, FLASH_MS)
    timers.current.add(timer)
  }, [flashes])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])
  return showing
}

/**
 * What's happening, by the players (#126): a caption over the active player
 * with his action and its target (the Shove or Tackle at the block), and roll
 * results flashed over the players they happened to. Taps go through to the board.
 */
export function Captions() {
  const game = useMatch((s) => s.game)!
  const file = useMatch((s) => s.file)!
  const caption = useMatch((s) => s.caption)
  const flashes = useFlashes(useMatch((s) => s.flashes))
  const captioned = caption ? game.players[caption.playerId] : undefined
  const flashFor = (playerId: string) => flashes.find((f) => f.playerId === playerId)

  return (
    <>
      {caption && captioned?.hex && (
        <div className={`caption ${captioned.team}`} style={over(captioned.hex)} data-caption={caption.playerId}>
          <div className="caption-text">{captionText(caption, game, file)}</div>
          {flashFor(caption.playerId) && (
            <div className="caption-flash" key={flashFor(caption.playerId)!.id}>
              {flashFor(caption.playerId)!.text}
            </div>
          )}
        </div>
      )}
      {flashes
        .filter((f) => f.playerId !== caption?.playerId || !captioned?.hex)
        .map((f) => (
          <div key={f.id} className={`caption flash-only ${game.players[f.playerId]?.team ?? ''}`} style={over(game.players[f.playerId]?.hex ?? f.hex)} data-flash={f.playerId}>
            <div className="caption-flash">{f.text}</div>
          </div>
        ))}
    </>
  )
}
