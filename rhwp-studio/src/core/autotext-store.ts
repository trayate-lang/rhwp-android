/** 상용구는 문서와 별개로 기기 안에 보관한다. 트랜잭션 완료 후에만 저장 성공이다. */
export interface AutotextEntry {
  keyword: string;
  description: string;
  kind: 'text' | 'body';
  text: string;
  html: string;
}

/** 긴 준말부터 비교하여 '결재'와 '재'가 함께 있을 때 긴 항목을 우선한다. */
export function matchAutotext(prefix: string, entries: AutotextEntry[]): AutotextEntry | undefined {
  return [...entries].sort((a, b) => b.keyword.length - a.keyword.length)
    .find(entry => prefix.endsWith(entry.keyword));
}

/** 저장 실패 시 기존 항목을 유지하며, 원문 HTML은 실행하거나 화면에 주입하지 않는다. */
export function validateAutotext(entry: AutotextEntry): void {
  if (!entry.keyword || /\s/.test(entry.keyword) || [...entry.keyword].length > 10) {
    throw new Error('준말은 공백 없이 1~10글자로 입력해 주세요.');
  }
  if (!entry.text && !entry.html) throw new Error('등록할 내용이 없습니다.');
  if (entry.kind === 'body' && !entry.html) throw new Error('서식 데이터를 읽지 못했습니다.');
  if (new Blob([entry.text, entry.html]).size > 16 * 1024 * 1024) {
    throw new Error('시험판은 상용구 한 개당 16MB까지 저장할 수 있습니다.');
  }
}

/** 연결을 작업마다 닫아 앱 재시작 및 이후 DB 버전 변경을 방해하지 않는다. */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('rhwp-autotext', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'keyword' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('상용구 저장소를 열지 못했습니다.'));
  });
}

export async function listAutotext(): Promise<AutotextEntry[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('entries').objectStore('entries').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('상용구 목록을 읽지 못했습니다.'));
    });
  } finally { db.close(); }
}

export async function writeAutotext(entry: AutotextEntry | string): Promise<void> {
  if (typeof entry !== 'string') validateAutotext(entry);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      if (typeof entry === 'string') store.delete(entry); else store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('저장하지 못했습니다. 기기 여유 공간을 확인해 주세요.'));
      tx.onerror = () => reject(new Error('상용구 저장 중 오류가 발생했습니다.'));
    });
  } finally { db.close(); }
}
