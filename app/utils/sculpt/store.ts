/**
 * IndexedDB persistence for sculpt jobs. Browser-only: every entry point
 * guards `typeof indexedDB === 'undefined'` so SSR and node (tests, tooling)
 * never throw — they just resolve empty / no-op instead.
 *
 * Not unit-tested per the brief; exercised by the Task 7 e2e.
 */

import type { JobStatus, SculptJob } from './job'

// v2 jobs carry a different shape from v1's pass ladder; a new database
// rather than a migration, since v1 runs are not worth keeping.
const DB_NAME = 'vitrum-sculpt-v2'
const DB_VERSION = 1
const STORE = 'jobs'

export interface JobSummary {
  id: string
  createdAt: number
  name: string
  status: JobStatus
  costUsd: number
  /** data URL */
  thumbnail: string
  /** SHA-256 of the photo the run was built from; absent on jobs stored before the field existed. */
  imageHash?: string
  /** A model is stored and can go straight onto the stage. */
  hasModel: boolean
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('failed to open IndexedDB'))
  })
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * A quota failure, by either of the two shapes browsers use: the modern
 * `QuotaExceededError` name, and Firefox's legacy numeric code 22.
 */
export function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: unknown, code?: unknown }
  return e.name === 'QuotaExceededError' || e.code === 22
}

/**
 * Which stored jobs to drop to make room for `keepId`. A sculpt job carries
 * its photo, every comparison sheet and a GLB, so one is megabytes and the
 * store fills after a handful: halving the history (oldest first, never the
 * job being written) buys room for several more runs, which is the point —
 * pruning exactly one would mean a prune on every subsequent save.
 */
export function prunePlan(entries: { id: string, createdAt: number }[], keepId: string): string[] {
  const others = entries
    .filter(e => e.id !== keepId)
    .sort((a, b) => a.createdAt - b.createdAt)
  if (others.length === 0) return []
  return others.slice(0, Math.max(1, Math.ceil(others.length / 2))).map(e => e.id)
}

function put(db: IDBDatabase, job: SculptJob): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(job)
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('failed to save job'))
    tx.onabort = () => reject(tx.error ?? new Error('save job transaction aborted'))
  })
}

export async function saveJob(job: SculptJob): Promise<void> {
  if (!hasIndexedDB()) return
  const db = await openDb()
  try {
    try {
      await put(db, job)
    }
    catch (error) {
      if (!isQuotaExceeded(error)) throw error
      // Out of room: drop the oldest runs — the history list is a convenience,
      // the run being written is not — and try once more.
      const tx = db.transaction(STORE, 'readonly')
      const all = await wrap(tx.objectStore(STORE).getAll()) as SculptJob[]
      const doomed = prunePlan(all.map(j => ({ id: j.id, createdAt: j.createdAt })), job.id)
      if (doomed.length === 0) throw error
      const del = db.transaction(STORE, 'readwrite')
      const store = del.objectStore(STORE)
      for (const id of doomed) store.delete(id)
      await new Promise<void>((resolve, reject) => {
        del.oncomplete = () => resolve()
        del.onerror = () => reject(del.error ?? new Error('failed to prune jobs'))
        del.onabort = () => reject(del.error ?? new Error('prune transaction aborted'))
      })
      await put(db, job)
    }
  }
  finally {
    db.close()
  }
}

export async function loadJob(id: string): Promise<SculptJob | null> {
  if (!hasIndexedDB()) return null
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const result = await wrap(tx.objectStore(STORE).get(id))
    return (result as SculptJob | undefined) ?? null
  }
  finally {
    db.close()
  }
}

export async function listJobs(): Promise<JobSummary[]> {
  if (!hasIndexedDB()) return []
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const all = await wrap(tx.objectStore(STORE).getAll())
    return (all as SculptJob[]).map(job => ({
      id: job.id,
      createdAt: job.createdAt,
      name: job.spec?.name ?? 'Untitled',
      status: job.status,
      costUsd: job.costUsd,
      thumbnail: job.image,
      imageHash: job.imageHash || undefined,
      hasModel: !!job.glb,
    }))
  }
  finally {
    db.close()
  }
}

export async function deleteJob(id: string): Promise<void> {
  if (!hasIndexedDB()) return
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('failed to delete job'))
      tx.onabort = () => reject(tx.error ?? new Error('delete job transaction aborted'))
    })
  }
  finally {
    db.close()
  }
}
