/** 전용 디버그 에뮬레이터에서만 실행한다. 개인 문서 대신 합성 문서로 작성 흐름을 검사한다. */
import assert from 'node:assert/strict';
import puppeteer from '../../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
try {
  const page = (await browser.pages()).find(p => p.url().endsWith('/assets/studio/index.html'));
  assert.ok(page); page.setDefaultTimeout(15000);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const a = window.rhwpStudio.automation;
    a.registerCommand({ id: 'ext:editing-qa', label: 'QA', execute(s) { window.__editingQA = s; } });
    a.execute('ext:editing-qa'); a.unregisterCommand('ext:editing-qa');
  });
  const cdp = await page.createCDPSession();
  const shortcut = async (key, modifiers = ['Control']) => {
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.keyboard.press(key);
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  };
  const state = () => page.evaluate(() => {
    const s = window.__editingQA, h = s.getInputHandler(), w = s.wasm;
    return { text: Array.from({ length: w.getParagraphCount(0) }, (_, p) => w.getTextRange(0, p, 0, 10000)),
      pages: w.pageCount, style: h.getCurrentStyleId(), pos: h.getCursorPosition(), composing: h.isComposing };
  });
  async function fresh() {
    await page.evaluate(() => { document.getElementById('sb-message').textContent = 'QA: waiting'; window.rhwpStudio.automation.execute('file:new-doc'); });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '저장 안 함') || !window.rhwpStudio.automation.getContext().isDirty);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '저장 안 함')?.click());
    await page.waitForFunction(() => document.getElementById('sb-message').textContent.startsWith('새 문서.hwp —') &&
      !window.rhwpStudio.automation.getContext().isDirty && !document.querySelector('.modal-overlay'));
    await page.evaluate(() => window.__editingQA.getInputHandler().focus());
  }

  await fresh();
  await page.evaluate(() => window.__editingQA.getInputHandler().insertAutotext('첫째 문단입니다.\n둘째 문단입니다.\n셋째 문단입니다.', ''));
  await page.evaluate(() => { const h = window.__editingQA.getInputHandler();
    h.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 1, charOffset: 0 }); h.cursor.setAnchor();
    h.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 1, charOffset: 9 }); h.focus(); });
  const before = await state();
  for (const key of ['n','w','j','k','e','r']) {
    await shortcut(key, ['Alt','Shift']);
    const after = await state(); assert.deepEqual(after.text, before.text); assert.equal(after.pages, before.pages);
  }
  console.log('자간/장평/크기: 둘째 문단 내용·쪽 수 보존');
  await page.evaluate(() => window.__editingQA.getInputHandler().cursor.clearSelection());
  for (let i = 1; i <= 10; i++) { await shortcut(String(i % 10)); assert.equal((await state()).style, i - 1); }
  assert.deepEqual((await state()).text, before.text);
  console.log('Ctrl+1..0: 문서의 첫 10개 스타일 적용');

  // 이전 버전이 저장한 HTML 들여쓰기까지 포함해 한 줄 본문 상용구를 준비한다.
  await fresh();
  await page.evaluate(async () => {
    const open = indexedDB.open('rhwp-autotext', 1);
    const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const tx = db.transaction('entries', 'readwrite');
    tx.objectStore('entries').put({ keyword: '논', description: '조합 회귀', kind: 'body', text: '논란',
      html: '<html><body>\n<!--StartFragment-->\n<p style="margin:0">\n<span style="font-weight:bold">논란</span></p>\n<!--EndFragment-->\n</body></html>' });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; }); db.close();
  });
  await cdp.send('Input.insertText', { text: '앞 ' });
  await cdp.send('Input.imeSetComposition', { text: '논', selectionStart: 1, selectionEnd: 1 });
  assert.equal((await state()).composing, true);
  await shortcut('i', ['Alt']);
  await page.waitForFunction(() => window.__editingQA.wasm.getTextRange(0, 0, 0, 100) === '앞 논란');
  assert.deepEqual((await state()).text, ['앞 논란']); assert.equal((await state()).composing, false);
  await shortcut('z'); assert.deepEqual((await state()).text, ['앞 논']);
  await shortcut('y'); assert.deepEqual((await state()).text, ['앞 논란']);
  // 뒤늦게 오는 compositionend도 확정 글자를 다시 삽입하거나 기록하면 안 된다.
  await page.evaluate(() => document.querySelector('textarea[aria-label="문서 편집 입력"]').dispatchEvent(new CompositionEvent('compositionend', { data: '논' })));
  assert.deepEqual((await state()).text, ['앞 논란']);
  console.log('실제 Chromium 조합 중 Alt+I: 글자 보존·추가 줄 없음·undo/redo·늦은 종료 이벤트 통과');

  await fresh();
  await cdp.send('Input.imeSetComposition', { text: '가', selectionStart: 1, selectionEnd: 1 });
  await shortcut('2'); assert.equal((await state()).style, 1); assert.deepEqual((await state()).text, ['가']);
  await shortcut('z'); assert.equal((await state()).style, 0); assert.deepEqual((await state()).text, ['가']);
  await shortcut('z'); assert.deepEqual((await state()).text, ['']);
  console.log('조합 중 Ctrl+2: 스타일·조합 입력의 실행 취소 순서 보존');

  // 실제 시간 간격으로 자동 저장되고, 편집 중 복구 창이 뜨지 않는지 확인한다.
  await fresh(); await cdp.send('Input.insertText', { text: '강제 종료 복구 시험 문장' });
  await page.waitForFunction(async () => {
    const open = indexedDB.open('rhwpStudioAutosave', 1);
    const db = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
    const req = db.transaction('drafts').objectStore('drafts').getAll();
    const rows = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); }); db.close();
    return rows.some(r => r.fileName === '새 문서.hwp' && Date.now() - r.savedAt < 6000);
  }, { timeout: 8000, polling: 300 });
  assert.equal(await page.$('.recovery-dialog'), null);
  console.log('입력 후 자동 저장 완료·편집 중 복구 창 없음 (강제 종료 후 복구용 문서 남김)');
} finally { await browser.disconnect(); }
