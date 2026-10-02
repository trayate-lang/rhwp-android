/** 앱 수명/공유/파일 연결만 맡고, 실제 편집 명령은 원본 dispatcher로 보낸다. */
import { getAndroidHost, type NativeFile } from './android-host.ts';
import type { FileSystemFileHandleLike, FileSystemWindowLike } from '../command/file-system-access.ts';

export interface AndroidRuntimeOptions {
  ready: Promise<unknown>;
  open: (file: File, handle: FileSystemFileHandleLike) => Promise<void>;
  dispatch: (id: string) => void;
  checkpoint: () => Promise<unknown>;
  mayClose: () => Promise<boolean>;
  exportFile: () => { bytes: Uint8Array; name: string; protected: boolean };
  report: (message: string) => void;
}

export function prepareAndroidHost(): void {
  const host = getAndroidHost();
  if (!host) return;
  host.installPickers(window as FileSystemWindowLike);
  document.documentElement.classList.add('rhwp-android');
  // 텍스트 클립보드를 Android에 연결한다. 표/서식의 내부 복사 버퍼는 원본이 관리한다.
  const clipboard = navigator.clipboard;
  if (clipboard) {
    Object.defineProperty(clipboard, 'readText', { value: async () => (await host.call<{ text: string }>('clipboardRead')).text });
    Object.defineProperty(clipboard, 'writeText', { value: async (text: string) => { await host.call('clipboardWrite', { text }); } });
  }
}

export function installAndroidRuntime(options: AndroidRuntimeOptions): void {
  const host = getAndroidHost();
  if (!host) return;
  const reportError = (error: unknown) => options.report(error instanceof Error ? error.message : '앱 작업에 실패했습니다.');
  const openIncoming = async (metadata: NativeFile) => {
    try { await options.ready; const handle = host.handle(metadata); await options.open(await handle.getFile(), handle); }
    catch (error) { reportError(error); }
  };
  (window as any).rhwpAndroid = {
    openIncoming,
    checkpoint: () => options.checkpoint().catch(reportError),
    requestBack: () => { void options.mayClose().then(async close => { if (close) await host.call('close'); }).catch(reportError); return true; },
  };
  const bar = document.createElement('nav');
  bar.className = 'rhwp-android-bar';
  bar.setAttribute('aria-label', 'Android 파일 작업');
  const button = (label: string, action: () => void) => {
    const item = document.createElement('button'); item.type = 'button'; item.textContent = label;
    item.addEventListener('click', action); bar.append(item);
  };
  button('열기', () => options.dispatch('file:open'));
  button('저장', () => options.dispatch('file:save'));
  button('공유', () => {
    void (async () => {
      const file = options.exportFile();
      if (file.protected) throw new Error('암호 문서는 원본의 저장 기능으로 저장한 후 Android 파일 앱에서 공유해 주세요.');
      await host.transfer(new Blob([new Uint8Array(file.bytes)]), { kind: 'share', name: file.name });
    })().catch(reportError);
  });
  button('안내', () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'rhwp-android-help';
    const text = document.createElement('p');
    text.textContent = 'rHWP Fold · 오프라인 HWP/HWPX 편집기\n\n접기·펼치기 중 문서 상태를 유지합니다. 폰 설정 → 디스플레이 → 커버 화면에서 앱 계속 사용을 켜면 접은 뒤에도 이어 쓸 수 있습니다.\n\n기본 글꼴은 공개 글꼴로 대체되므로 원본과 줄바꿈이 다를 수 있습니다. 중요한 문서는 사본으로 저장하고 다시 확인하세요.\n\n원본: edwardkim/rhwp · MIT License. 공개 소스와 제3자 라이선스 고지는 APK의 legal 및 fonts 자산에 포함되어 있습니다.';
    const close = document.createElement('button'); close.textContent = '닫기'; close.onclick = () => dialog.close();
    dialog.append(text, close); dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  });
  document.body.append(bar);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void options.checkpoint().catch(reportError); });
  void options.ready.then(() => host.call('ready')).catch(reportError);
}
