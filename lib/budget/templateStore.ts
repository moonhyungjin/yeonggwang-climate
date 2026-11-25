// hwpx 만들 때 서식으로 쓰는 기존 설명서를 이 브라우저(IndexedDB)에 저장. 서버로는 보내지 않는다.
// localStorage는 용량이 작아(보통 5MB, 문자열만) 1MB 넘는 hwpx는 IndexedDB에 둔다.
const DB = "budget-template", STORE = "files";
// key: "template"(세부사업설명서), "contract"(계약서)

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => { resolve(req.result as T); db.close(); };
    req.onerror = () => { reject(req.error); db.close(); };
  }));
}

type Saved = { name: string; lastModified: number; data: ArrayBuffer };

export async function saveTemplate(f: File, key = "template"): Promise<boolean> {
  try {
    const rec: Saved = { name: f.name, lastModified: f.lastModified, data: await f.arrayBuffer() };
    await run("readwrite", (s) => s.put(rec, key));
    return true;
  } catch { return false; }
}

export async function loadTemplate(key = "template"): Promise<File | null> {
  try {
    const rec = await run<Saved | undefined>("readonly", (s) => s.get(key));
    return rec ? new File([rec.data], rec.name, { lastModified: rec.lastModified }) : null;
  } catch { return null; }
}
