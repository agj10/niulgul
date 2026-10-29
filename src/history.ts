export type ImageKind = 'source' | 'target';
export type SavedImage = { id: string; kind: ImageKind; name: string; blob: Blob; thumbnail: string; width: number; height: number; createdAt: number; framed?: boolean };
const DATABASE = 'niulgul-images', STORE = 'images';
export const HISTORY_LIMIT = 12, HISTORY_BYTES = 64 * 1024 * 1024;
let database: Promise<IDBDatabase> | undefined;
let writes: Promise<unknown> = Promise.resolve();

function open(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('사진 기록을 저장할 수 없어요.'));
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('다른 탭을 닫고 다시 시도해 주세요.')); };
  });
  return database;
}
export function retainedImages(images: SavedImage[]): SavedImage[] {
  let bytes = 0;
  const counts = { source: 0, target: 0 };
  return [...images].sort((a, b) => b.createdAt - a.createdAt).filter(image => {
    if (counts[image.kind] >= HISTORY_LIMIT || bytes + image.blob.size > HISTORY_BYTES) return false;
    counts[image.kind]++; bytes += image.blob.size; return true;
  });
}
export async function readHistory(): Promise<SavedImage[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(retainedImages(request.result));
    request.onerror = () => reject(request.error);
  });
}
function write(change: (images: SavedImage[], store: IDBObjectStore) => void): Promise<SavedImage[]> {
  const task = writes.catch(() => {}).then(async () => {
    const db = await open();
    return new Promise<SavedImage[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE), request = store.getAll();
      request.onsuccess = () => change(request.result, store);
      let images: SavedImage[] = [];
      // This request runs after change's puts/deletes, inside the same transaction.
      request.addEventListener('success', () => {
        const final = store.getAll(); final.onsuccess = () => { images = retainedImages(final.result); };
      });
      tx.oncomplete = () => resolve(images);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('사진 기록을 저장하지 못했어요.'));
    });
  });
  writes = task;
  return task;
}
export function canvasBlob(image: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => image.toBlob(blob => blob ? resolve(blob) : reject(new Error('사진을 저장하지 못했어요.')), 'image/png'));
}
export async function saveImage(image: HTMLCanvasElement, kind: ImageKind, name: string, framed = false): Promise<{ saved: SavedImage; images: SavedImage[] }> {
  const blob = await canvasBlob(image);
  if (blob.size > HISTORY_BYTES) throw new Error('이 사진은 기록에 저장하기에 너무 커요.');
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const id = kind + '-' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const thumb = document.createElement('canvas'), scale = Math.min(1, 160 / Math.max(image.width, image.height));
  thumb.width = Math.max(1, Math.round(image.width * scale)); thumb.height = Math.max(1, Math.round(image.height * scale));
  thumb.getContext('2d')!.drawImage(image, 0, 0, thumb.width, thumb.height);
  const saved: SavedImage = { id, kind, name, blob, thumbnail: thumb.toDataURL('image/jpeg', 0.8), width: image.width, height: image.height, createdAt: Date.now(), framed };
  const images = await write((existing, store) => {
    const retained = retainedImages([saved, ...existing.filter(item => item.id !== id)]);
    const ids = new Set(retained.map(item => item.id));
    for (const item of existing) if (!ids.has(item.id)) store.delete(item.id);
    store.put(saved);
  });
  return { saved, images };
}
export function removeImage(id: string) { return write((_images, store) => { store.delete(id); }); }
