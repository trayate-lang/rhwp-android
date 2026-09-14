import test from 'node:test';
import assert from 'node:assert/strict';
import { AndroidHost, decodeBytes, encodeBytes, type NativeTransport } from '../src/platform/android-host.ts';
import { saveDocumentToFileSystem, pickOpenFileHandle } from '../src/command/file-system-access.ts';

/** 실제 OS 대신 응답을 제어해 취소/실패/지연이 원본 파일 인터페이스에 전달되는지 검사한다. */
function hostWith(handler: (method: string, args: any, answer: (result?: any, error?: any) => void) => void) {
  const transport: NativeTransport = {
    onmessage: null,
    postMessage(raw) {
      const { id, method, args } = JSON.parse(raw);
      handler(method, args, (result, error) => queueMicrotask(() => transport.onmessage?.({ data: JSON.stringify({ id, result, error }) })));
    },
  };
  return new AndroidHost(transport);
}

test('Android: 여러 전송 조각에 걸친 바이너리 문서를 손실 없이 읽는다', async () => {
  const source = Uint8Array.from({ length: 600_001 }, (_, i) => i % 256);
  const host = hostWith((method, args, answer) => {
    assert.equal(method, 'read');
    answer({ data: encodeBytes(source.slice(args.offset, args.offset + args.length)) });
  });
  const file = await host.read({ handle: 'doc', name: '한글.hwpx', size: source.length });
  assert.equal(file.name, '한글.hwpx');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
});

test('Android: 파일 선택 취소는 오류나 다운로드가 아니라 null로 전달된다', async () => {
  const host = hostWith((_method, _args, answer) => answer(undefined, { code: 'CANCELLED', message: '취소' }));
  const pickers = {}; host.installPickers(pickers);
  assert.equal(await pickOpenFileHandle(pickers), null);
});

test('Android: 실제 저장 완료 응답 전에는 저장 함수가 성공하지 않는다', async () => {
  let finish: ((result: any) => void) | undefined;
  const received: number[] = [];
  const host = hostWith((method, args, answer) => {
    if (method === 'begin') answer({ transfer: 'write' });
    else if (method === 'append') { received.push(...decodeBytes(args.data)); answer({}); }
    else if (method === 'finish') finish = answer;
  });
  const handle = host.handle({ handle: 'doc', name: '문서.hwp', size: 1 });
  let completed = false;
  const saved = saveDocumentToFileSystem({ blob: new Blob(['edited']), suggestedName: '문서.hwp', currentHandle: handle, windowLike: {}, forceSaveAs: false, saveFormat: 'hwp' }).then(result => { completed = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false); assert.ok(finish);
  assert.equal(new TextDecoder().decode(Uint8Array.from(received)), 'edited');
  finish({ size: 6 });
  assert.equal((await saved).method, 'current-handle');
});

test('Android: 저장 실패는 호출자까지 거부되고 전송을 정리한다', async () => {
  let aborted = false;
  const host = hostWith((method, _args, answer) => {
    if (method === 'begin') answer({ transfer: 'write' });
    else if (method === 'finish') answer(undefined, { code: 'WRITE_FAILED', message: '저장 실패' });
    else { if (method === 'abort') aborted = true; answer({}); }
  });
  await assert.rejects(host.transfer(new Blob(['data']), { kind: 'save', handle: 'doc' }), /저장 실패/);
  assert.equal(aborted, true);
});

test('Android: 잘린 읽기 응답을 정상 문서로 내보내지 않는다', async () => {
  const host = hostWith((_method, _args, answer) => answer({ data: encodeBytes(new Uint8Array([1])) }));
  await assert.rejects(host.read({ handle: 'doc', name: '손상.hwp', size: 2 }), /일부 데이터/);
});
