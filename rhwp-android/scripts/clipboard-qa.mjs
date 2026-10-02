/** 전용 디버그 에뮬레이터에서 OS 클립보드 → 길게 누르기 → 문서 삽입을 검사한다. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import puppeteer from '../../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const adb = process.env.ADB || 'adb';
const shell = (...args) => execFileSync(adb, ['-s', 'emulator-5554', 'shell', ...args], { encoding: 'utf8' });
// 개인 폰이나 다른 WebView에 시험 내용을 붙이지 않도록 대상과 검사 포트를 직접 묶는다.
const pid = shell('pidof', 'io.github.trayate_lang.rhwp.debug').trim();
assert.match(pid, /^\d+$/);
execFileSync(adb, ['-s', 'emulator-5554', 'forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`]);
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
let page;
try {
  page = (await browser.pages()).find(p => p.url().endsWith('/assets/studio/index.html'));
  assert.ok(page); page.setDefaultTimeout(15000);
  await page.waitForFunction(() => window.rhwpStudio?.automation);
  // 이전 검사 복구본은 지우지 않고 남겨 둔다. 이번 검사는 새 합성 문서에서만 진행한다.
  await page.evaluate(() => [...document.querySelectorAll('.recovery-dialog button')]
    .find(b => b.textContent.trim() === '나중에')?.click());
  await page.waitForFunction(() => !document.querySelector('.recovery-dialog'));
  // 앞선 상용구 검사 등이 남긴 편집 대화상자를 닫아 새 문서 명령의 전제조건을 맞춘다.
  await page.keyboard.press('Escape');
  async function fresh() {
    await page.evaluate(() => {
      document.getElementById('sb-message').textContent = 'QA: waiting';
      window.rhwpStudio.automation.execute('file:new-doc');
    });
    await page.waitForFunction(() => [...document.querySelectorAll('button')]
      .some(b => b.textContent.trim() === '저장 안 함') || !window.rhwpStudio.automation.getContext().isDirty);
    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === '저장 안 함')?.click());
    await page.waitForFunction(() => document.getElementById('sb-message').textContent.startsWith('새 문서.hwp —') &&
      !window.rhwpStudio.automation.getContext().isDirty && !document.querySelector('.modal-overlay'));
  }
  await fresh();
  await page.evaluate(() => {
    const a = window.rhwpStudio.automation;
    a.registerCommand({ id: 'ext:clipboard-qa', label: 'QA', execute(s) { window.__clipboardQA = s; } });
    a.execute('ext:clipboard-qa'); a.unregisterCommand('ext:clipboard-qa');
  });
  const documentText = () => page.evaluate(() => {
    const w = window.__clipboardQA.wasm;
    return Array.from({ length: w.getParagraphCount(0) }, (_, i) => w.getTextRange(0, i, 0, 10000)).join('\n');
  });
  const cdp = await page.createCDPSession();
  const text = '삼성 노트에서 복사한 한글입니다.\n둘째 줄과 숫자 123, 기호 %를 유지합니다.';
  await page.evaluate(text => navigator.clipboard.writeText(text), text);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), text, 'Android OS 클립보드 준비');
  // CDP의 touch 이벤트는 Android의 길게 누르기 판정까지 전달하지 않는다.
  // 실제 OS 터치를 쓰고, 상태 표시줄 높이는 UI 트리에서 읽어 기종별 차이를 피한다.
  shell('uiautomator', 'dump', '/sdcard/rhwp-clipboard-qa.xml');
  const xml = shell('cat', '/sdcard/rhwp-clipboard-qa.xml');
  const webview = xml.match(/class="android.webkit.WebView"[^>]*bounds="\[(\d+),(\d+)\]/);
  assert.ok(webview, '화면에 표시된 WebView 경계');
  const point = await page.evaluate(() => {
    const r = window.__clipboardQA.getInputHandler().container.getBoundingClientRect();
    return { x: Math.round((r.left + r.width / 2) * devicePixelRatio),
      y: Math.round((r.top + r.height / 2) * devicePixelRatio) };
  });
  const x = String(point.x + Number(webview[1]));
  const y = String(point.y + Number(webview[2]));
  shell('input', 'swipe', x, y, x, y, '900');
  await page.waitForSelector('.context-menu [data-cmd="edit:paste"]');
  console.log('Android 길게 누르기 → 붙이기 메뉴 표시 확인');
  await page.click('.context-menu [data-cmd="edit:paste"]');
  await page.waitForFunction(text => {
    const w = window.__clipboardQA.wasm;
    return Array.from({ length: w.getParagraphCount(0) }, (_, i) => w.getTextRange(0, i, 0, 10000)).join('\n') === text;
  }, { timeout: 3000 }, text);
  console.log('OS 클립보드 → 길게 누르기 붙이기: 한글·여러 줄 삽입 통과');

  await page.evaluate(() => window.rhwpStudio.automation.execute('edit:undo'));
  assert.equal(await documentText(), '', '두 줄 전체를 한 번에 실행 취소');
  await page.evaluate(() => window.rhwpStudio.automation.execute('edit:redo'));
  assert.equal(await documentText(), text, '다시 실행으로 내용 복원');
  console.log('여러 줄 붙이기: 한 번의 실행 취소·다시 실행 통과');

  // 편집기에서 먼저 복사해 내부 버퍼를 만든 뒤, 다른 앱의 새 복사로 덮어쓴다.
  await page.evaluate(() => {
    const h = window.__clipboardQA.getInputHandler();
    h.performSelectAll(); h.performCopy();
  });
  await page.waitForFunction(async text => await navigator.clipboard.readText() === text, {}, text);
  const replacement = '바꾼 첫 줄\n바꾼 둘째 줄';
  await page.evaluate(text => navigator.clipboard.writeText(text), replacement);
  assert.equal(await page.evaluate(() => window.__clipboardQA.getInputHandler().performPaste()), true);
  assert.equal(await documentText(), replacement, '과거 내부 복사 대신 새 OS 텍스트로 선택 교체');
  await page.evaluate(() => window.rhwpStudio.automation.execute('edit:undo'));
  assert.equal(await documentText(), text, '교체 전 선택 내용 복원');
  console.log('다른 앱 복사 우선·선택 영역 교체·실행 취소 통과');

  // 외부 키보드는 메뉴와 달리 WebView의 원래 paste 이벤트로 들어온다.
  await fresh();
  await page.evaluate(() => navigator.clipboard.writeText('단축키 첫 줄\n단축키 둘째 줄'));
  await page.evaluate(() => window.__clipboardQA.getInputHandler().focus());
  await page.keyboard.down('Control'); await page.keyboard.press('v'); await page.keyboard.up('Control');
  assert.equal(await documentText(), '단축키 첫 줄\n단축키 둘째 줄');
  await page.evaluate(() => window.rhwpStudio.automation.execute('edit:undo'));
  assert.equal(await documentText(), '');
  console.log('Ctrl+V의 원래 paste 이벤트·여러 줄·한 번의 실행 취소 통과');

  // Chromium IME 조합을 사용한다. 삼성 키보드 실기기 검사는 별도로 기록한다.
  await fresh();
  await page.evaluate(() => navigator.clipboard.writeText(' 뒤에 붙이기'));
  await page.evaluate(() => window.__clipboardQA.getInputHandler().focus());
  await cdp.send('Input.insertText', { text: '앞 ' });
  await cdp.send('Input.imeSetComposition', { text: '한글', selectionStart: 2, selectionEnd: 2 });
  assert.equal(await page.evaluate(() => window.__clipboardQA.getInputHandler().isComposing), true);
  await page.evaluate(() => window.__clipboardQA.getInputHandler().performPaste());
  assert.equal(await documentText(), '앞 한글 뒤에 붙이기');
  assert.equal(await page.evaluate(() => window.__clipboardQA.getInputHandler().isComposing), false);
  await page.evaluate(() => window.rhwpStudio.automation.execute('edit:undo'));
  assert.equal(await documentText(), '앞 한글', '조합 글자를 남기고 붙인 내용만 취소');
  console.log('한글 조합 마감 후 붙이기·실행 취소 통과');

  await fresh();
  await page.evaluate(() => navigator.clipboard.writeText(''));
  assert.equal(await page.evaluate(() => window.__clipboardQA.getInputHandler().performPaste()), false);
  assert.equal(await documentText(), '');
  assert.equal(await page.evaluate(() => window.rhwpStudio.automation.getContext().canUndo), false);
  assert.equal(await page.evaluate(() => window.rhwpStudio.automation.getContext().isDirty), false);
  await page.evaluate(() => window.__clipboardQA.setEditMode('form'));
  await page.evaluate(() => navigator.clipboard.writeText('금지된 붙이기'));
  assert.equal(await page.evaluate(() => window.__clipboardQA.getInputHandler().performPaste()), false);
  assert.equal(await documentText(), '');
  await page.evaluate(() => window.__clipboardQA.setEditMode('normal'));
  console.log('빈 클립보드·양식 모드: 문서와 실행 취소 기록 무변경 통과');

  // 실패/늦은 응답만 OS 경계에서 제어한다. 편집기·메뉴·실제 삽입 함수는 바꾸지 않는다.
  await page.evaluate(() => {
    const native = window.RhwpNative;
    const original = native.postMessage.bind(native);
    window.__restoreClipboardTransport = () => { native.postMessage = original; };
    native.postMessage = message => {
      const request = JSON.parse(message);
      if (request.method !== 'clipboardRead') return original(message);
      native.onmessage({ data: JSON.stringify({ id: request.id, error: { message: 'QA: clipboard unavailable' } }) });
    };
    window.rhwpStudio.automation.execute('edit:paste');
  });
  await page.waitForFunction(() => document.getElementById('rhwp-toast-container')?.textContent.includes('붙여넣지 못했습니다'));
  assert.equal(await documentText(), '');
  await page.evaluate(() => window.__restoreClipboardTransport());
  console.log('OS 읽기 실패: 안내 표시·문서 무변경 통과');

  await page.evaluate(() => {
    const native = window.RhwpNative;
    const original = native.postMessage.bind(native);
    window.__restoreClipboardTransport = () => { native.postMessage = original; };
    native.postMessage = message => {
      const request = JSON.parse(message);
      if (request.method !== 'clipboardRead') return original(message);
      window.__releaseClipboard = () => native.onmessage({ data: JSON.stringify({ id: request.id, result: { text: '이전 문서의 지연된 붙이기' } }) });
    };
    window.__pendingClipboardPaste = window.__clipboardQA.getInputHandler().performPaste();
  });
  await page.waitForFunction(() => !!window.__releaseClipboard);
  await fresh();
  await page.evaluate(() => window.__releaseClipboard());
  assert.equal(await page.evaluate(() => window.__pendingClipboardPaste), false);
  assert.equal(await documentText(), '');
  await page.evaluate(() => window.__restoreClipboardTransport());
  console.log('클립보드 응답 전 문서 전환: 새 문서에 잘못 붙이지 않음 통과');
} finally {
  // 검사 중 단언이 실패해도 OS 경계 대역을 남기지 않는다.
  if (page) await page.evaluate(() => window.__restoreClipboardTransport?.()).catch(() => {});
  await browser.disconnect();
}
