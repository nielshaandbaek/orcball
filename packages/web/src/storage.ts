// The match in progress, saved in IndexedDB after every command so a reload
// doesn't lose it. A tiny wrapper rather than a library: one store, one key.

const DB = 'orcball'
const STORE = 'matches'
const KEY = 'current'

function open(): Promise<IDBDatabase> | null {
  if (typeof indexedDB === 'undefined') return null
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const opening = open()
  if (!opening) return null
  const db = await opening
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveMatch(json: string): Promise<void> {
  await run('readwrite', (s) => s.put(json, KEY))
}

export async function loadMatch(): Promise<string | null> {
  return ((await run('readonly', (s) => s.get(KEY))) as string | undefined) ?? null
}

export async function clearMatch(): Promise<void> {
  await run('readwrite', (s) => s.delete(KEY))
}
