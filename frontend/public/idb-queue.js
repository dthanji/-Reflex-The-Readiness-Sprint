// Minimal IndexedDB queue for status updates made while offline.
// Design note (trade-off logged): this uses last-write-wins semantics —
// if a rider's phone queues an update offline and another actor changes
// the request's state in the meantime, the queued update is replayed
// as-is when connectivity returns. The server's transition guard
// (VALID_TRANSITIONS in status.js) will reject it with a 409 if it no
// longer makes sense, rather than corrupting state silently — but there's
// no merge/reconciliation UI yet, just a rejection.

const DB_NAME = 'reflex-offline';
const STORE = 'pending_events';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'clientEventId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueAdd(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queueAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueRemove(clientEventId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(clientEventId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

window.ReflexQueue = { queueAdd, queueAll, queueRemove };
