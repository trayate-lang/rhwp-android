/** Android 파일 연결부. Studio에는 브라우저 File System Access와 같은 작은 계약만 제공한다. */
import type { FileSystemFileHandleLike, FileSystemWindowLike } from '../command/file-system-access.ts';

export interface NativeTransport {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
export interface NativeFile { handle: string; name: string; size: number }
const CHUNK_BYTES = 256 * 1024;
const MAX_BYTES = 128 * 1024 * 1024;

/** UTF-8 문서를 문자열로 바꾸지 않고 바이트 그대로 조각 전송한다. 큰 인자 spread도 피한다. */
export function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeBytes(encoded: string): Uint8Array { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }

export class AndroidHost {
  private sequence = 0;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private handles = new WeakMap<object, string>();
  private transport: NativeTransport;

  constructor(transport: NativeTransport) {
    this.transport = transport;
    transport.onmessage = event => {
      let response: any;
      try { response = JSON.parse(event.data); } catch { return; }
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id); clearTimeout(request.timer);
      if (response.error) {
        const error = response.error.code === 'CANCELLED'
          ? new DOMException(response.error.message, 'AbortError')
          : new Error(response.error.message || 'Android 파일 작업에 실패했습니다.');
        request.reject(error);
      } else request.resolve(response.result);
    };
  }

  /** 선택창은 사용자가 결정할 때까지 기다린다. I/O 응답은 유실 시 무한 대기하지 않는다. */
  call<T = Record<string, unknown>>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('앱 응답을 받지 못했습니다. 작업 결과를 확인한 후 다시 시도해 주세요.')); }, method === 'open' || method === 'pickSave' ? 30 * 60_000 : 120_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.transport.postMessage(JSON.stringify({ id, method, args })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async read(metadata: NativeFile): Promise<File> {
    if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > MAX_BYTES) throw new Error('지원하는 문서 크기를 초과했습니다.');
    const bytes = new Uint8Array(metadata.size);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      const count = Math.min(CHUNK_BYTES, bytes.length - offset);
      const result = await this.call<{ data: string }>('read', { handle: metadata.handle, offset, length: count });
      const chunk = decodeBytes(result.data);
      if (chunk.length !== count) throw new Error('문서의 일부 데이터를 읽지 못했습니다.');
      bytes.set(chunk, offset);
    }
    return new File([bytes], metadata.name);
  }

  async transfer(blob: Blob, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (blob.size < 1 || blob.size > MAX_BYTES) throw new Error('128MB 이하의 문서만 내보낼 수 있습니다.');
    const { transfer } = await this.call<{ transfer: string }>('begin', { ...args, size: blob.size });
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
        await this.call('append', { transfer, offset, data: encodeBytes(bytes) });
      }
      return await this.call('finish', { transfer });
    } catch (error) {
      await this.call('abort', { transfer }).catch(() => undefined);
      throw error; // 실패를 다운로드 성공으로 바꾸지 않는다.
    }
  }

  handle(metadata: NativeFile): FileSystemFileHandleLike {
    const handle: FileSystemFileHandleLike = {
      kind: 'file', name: metadata.name,
      getFile: () => this.read(metadata),
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      isSameEntry: async other => this.handles.get(other) === metadata.handle,
      createWritable: async () => {
        let pending: Blob | null = null;
        return {
          write: async blob => { pending = blob; },
          close: async () => {
            if (!pending) throw new Error('저장 데이터가 없습니다.');
            const saved = await this.transfer(pending, { kind: 'save', handle: metadata.handle, name: metadata.name });
            metadata.size = Number(saved.size);
          },
        };
      },
    };
    this.handles.set(handle, metadata.handle);
    return handle;
  }

  /** 원본의 열기/저장 코드가 같은 인터페이스를 사용하도록 Android 구현을 주입한다. */
  installPickers(target: FileSystemWindowLike): void {
    target.showOpenFilePicker = async () => [this.handle(await this.call<NativeFile>('open'))];
    target.showSaveFilePicker = async options => {
      const mime = Object.keys(options?.types?.[0]?.accept ?? {})[0] || 'application/octet-stream';
      return this.handle(await this.call<NativeFile>('pickSave', { name: options?.suggestedName || 'document.hwp', mime }));
    };
  }
}

let host: AndroidHost | null = null;
export function getAndroidHost(): AndroidHost | null {
  if (typeof window === 'undefined') return null;
  const transport = (window as unknown as { RhwpNative?: NativeTransport }).RhwpNative;
  if (!transport) return null;
  return host ??= new AndroidHost(transport);
}
