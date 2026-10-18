// Offline upload queue. Photos are saved on the phone (IndexedDB) first, then sent when there is signal.
// Each photo gets a client_id so a retry after a dropped connection never creates a duplicate.

import { api, ApiError, isNetworkError } from './api';

export interface QueuedPhoto {
  client_id: string;
  blob: Blob;
  name: string;
  created_at: string;
  state: 'waiting' | 'sending' | 'error';
  error?: string;
}

export interface UploadResult {
  upload_id: number;
  ok: boolean;
  receipt_ids: number[];
  error?: string;
}

const DB_NAME = 'budget-queue';
const STORE = 'photos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'client_id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const listQueue = () => tx<QueuedPhoto[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedPhoto[]>);
const putItem = (item: QueuedPhoto) => tx('readwrite', (s) => s.put(item));
export const removeFromQueue = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => notify());

function newId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

let running = false;
const listeners = new Set<() => void>();
export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

export async function addToQueue(blob: Blob, name: string): Promise<void> {
  await putItem({ client_id: newId(), blob, name, created_at: new Date().toISOString(), state: 'waiting' });
  notify();
  // Ask the browser not to clear our storage when the phone is low on space.
  navigator.storage?.persist?.().catch(() => undefined);
}

/** Sends every waiting photo. Returns the server results for the photos that went through. */
export async function processQueue(): Promise<UploadResult[]> {
  if (running || !navigator.onLine) return [];
  running = true;
  const results: UploadResult[] = [];
  try {
    for (const item of await listQueue()) {
      if (item.state === 'error') continue;
      await putItem({ ...item, state: 'sending' });
      notify();
      const form = new FormData();
      form.append('file', item.blob, item.name);
      form.append('client_id', item.client_id);
      try {
        results.push(await api<UploadResult>('/uploads', { form }));
        await removeFromQueue(item.client_id);
      } catch (e) {
        if (isNetworkError(e)) {
          await putItem({ ...item, state: 'waiting' }); // try again when the signal is back
          break;
        }
        await putItem({ ...item, state: 'error', error: e instanceof ApiError ? e.message : String(e) });
      }
      notify();
    }
  } finally {
    running = false;
    notify();
  }
  return results;
}

export async function retryItem(id: string): Promise<void> {
  const item = (await listQueue()).find((q) => q.client_id === id);
  if (item) await putItem({ ...item, state: 'waiting', error: undefined });
  notify();
}
