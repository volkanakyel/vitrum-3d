/**
 * IndexedDB persistence for sculpt jobs. Browser-only: every entry point
 * guards `typeof indexedDB === 'undefined'` so SSR and node (tests, tooling)
 * never throw — they just resolve empty / no-op instead.
 *
 * Not unit-tested per the brief; exercised by the Task 7 e2e.
 */

import type { JobStatus, SculptJob } from './job'

const DB_NAME = 'vitrum-sculpt'
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

export async function saveJob(job: SculptJob): Promise<void> {
  if (!hasIndexedDB()) return
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(job)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('failed to save job'))
      tx.onabort = () => reject(tx.error ?? new Error('save job transaction aborted'))
    })
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
      name: job.spec?.name ?? job.intake?.name ?? 'Untitled',
      status: job.status,
      costUsd: job.costUsd,
      thumbnail: job.image,
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
