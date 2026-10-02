/** 전용 디버그 에뮬레이터에서만 실행: 시험 문서를 새로 만들며 개인 문서에는 사용하지 않는다. */
import assert from 'node:assert/strict';
import puppeteer from '../../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
try {
  const page = (await browser.pages()).find(page => page.url().endsWith('/assets/studio/index.html'));
  assert.ok(page);
  page.setDefaultTimeout(10000);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '복구')?.click());
  await page.waitForFunction(() => window.rhwpStudio?.automation.getContext().hasDocument);
  await page.evaluate(() => {
    const a = window.rhwpStudio.automation;
    a.registerCommand({ id: 'ext:autotext-qa', label: 'QA', execute(services) { window.__autotextQA = services; } });
    a.execute('ext:autotext-qa'); a.unregisterCommand('ext:autotext-qa');
  });
  const suffix = String(Date.now()).slice(-5);
  const altI = async () => { await page.keyboard.down('Alt'); await page.keyboard.press('i'); await page.keyboard.up('Alt'); };
  const text = () => page.evaluate(() => window.__autotextQA.wasm.getTextRange(0, 0, 0, 1000));

  /** 원본 새 문서 명령을 사용하여 엔진·화면·히스토리를 함께 초기화한다. */
  async function newDocument() {
    await page.evaluate(() => {
      document.getElementById('sb-message').textContent = 'QA: 새 문서 준비 대기';
      window.rhwpStudio.automation.execute('file:new-doc');
    });
    await page.waitForFunction(() => document.querySelector('.unsaved-changes-dialog') ||
      [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '저장 안 함') ||
      !window.rhwpStudio.automation.getContext().isDirty);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '저장 안 함')?.click());
    await page.waitForFunction(() => window.rhwpStudio.automation.getContext().hasDocument &&
      document.getElementById('sb-message').textContent.startsWith('새 문서.hwp —') &&
      !window.rhwpStudio.automation.getContext().isDirty && !document.querySelector('.modal-overlay'));
    await page.evaluate(() => window.__autotextQA.getInputHandler().focus());
  }
  async function register(keyword, body = true) {
    await page.evaluate(() => window.__autotextQA.getInputHandler().focus());
    await altI();
    await page.waitForSelector('input[aria-label="준말"]');
    const state = await page.evaluate(({ keyword, body }) => {
      const check = document.querySelector('.modal-overlay input[type="checkbox"]');
      const captured = { text: document.querySelector('textarea').value, forcedBody: check.disabled };
      document.querySelector('input[aria-label="준말"]').value = keyword;
      check.checked = body;
      document.querySelector('.modal-overlay .dialog-btn-primary').click();
      return captured;
    }, { keyword, body });
    await page.waitForFunction(() => !document.querySelector('.modal-overlay'));
    return state;
  }
  async function expand(keyword) {
    await page.evaluate(() => window.__autotextQA.getInputHandler().focus());
    await (await page.createCDPSession()).send('Input.insertText', { text: keyword });
    await page.waitForFunction(k => window.__autotextQA.wasm.getTextRange(0, 0, 0, 100).includes(k), {}, keyword);
    await altI();
    await page.waitForFunction(k => !window.__autotextQA.wasm.getTextRange(0, 0, 0, 100).includes(k), {}, keyword);
  }

  // 글자: 등록 후 새 문서에서 치환하고 undo/redo가 준말까지 정확히 보존하는지 검사한다.
  await newDocument();
  await (await page.createCDPSession()).send('Input.insertText', { text: '상용구 시험 문장' });
  await page.waitForFunction(() => window.__autotextQA.wasm.getTextRange(0, 0, 0, 100) === '상용구 시험 문장');
  await page.evaluate(() => {
    const h = window.__autotextQA.getInputHandler();
    h.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }); h.cursor.setAnchor();
    h.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 9 });
  });
  const plainKey = `문${suffix}`;
  await register(plainKey, false);
  await newDocument(); await expand(plainKey);
  assert.equal(await text(), '상용구 시험 문장');
  await page.evaluate(() => window.__autotextQA.getInputHandler().performUndo());
  assert.equal(await text(), plainKey);
  await page.evaluate(() => window.__autotextQA.getInputHandler().performRedo());
  assert.equal(await text(), '상용구 시험 문장');
  console.log('글자 등록/다른 문서 치환/undo/redo 통과');

  // 같은 문장을 굵게 지정한 뒤 본문 상용구로 등록한다.
  await page.evaluate(() => {
    const h = window.__autotextQA.getInputHandler(); h.cursor.clearSelection();
    h.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 }); h.cursor.setAnchor();
    h.cursor.moveTo({ sectionIndex: 0, paragraphIndex: 0, charOffset: 9 });
    window.rhwpStudio.automation.execute('format:bold');
  });
  const richKey = `서${suffix}`;
  await register(richKey); await newDocument(); await expand(richKey);
  assert.match(await page.evaluate(() => window.__autotextQA.wasm.exportSelectionHtml(0, 0, 0, 0, 9)), /font-weight:bold/);
  console.log('다른 문서에서 굵게 서식 보존 통과');

  // 표/그림은 기존 삽입기로 합성 시험 자료를 만든 뒤 실제 등록 UI를 통과시킨다.
  for (const kind of ['table', 'image']) {
    await newDocument();
    await page.evaluate(kind => {
      const h = window.__autotextQA.getInputHandler();
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d'); context.fillStyle = '#ff00aa'; context.fillRect(0, 0, 32, 32);
      h.insertAutotext('', kind === 'table'
        ? '<table><tr><td>첫째 셀</td><td>둘째 셀</td></tr></table>'
        : `<img width="32" height="32" src="${canvas.toDataURL()}">`);
      h.cursor.clearSelection();
      const control = window.__autotextQA.wasm.getPageControlLayout(0).controls.find(c => c.type === kind || (kind === 'image' && c.type === 'picture'));
      if (!control) throw new Error('시험 개체의 실제 위치를 찾지 못했습니다.');
      if (kind === 'table') h.cursor.enterTableObjectSelectionDirect(control.secIdx, control.paraIdx, control.controlIdx);
      else h.cursor.enterPictureObjectSelectionDirect(control.secIdx, control.paraIdx, control.controlIdx);
    }, kind);
    const key = `${kind === 'table' ? '표' : '그'}${suffix}`;
    assert.equal((await register(key)).forcedBody, true);
    await newDocument(); await expand(key);
    const exported = await page.evaluate(kind => {
      const wasm = window.__autotextQA.wasm;
      const c = wasm.getPageControlLayout(0).controls.find(c => c.type === kind || (kind === 'image' && c.type === 'picture'));
      if (!c) throw new Error('복원된 개체가 없습니다.');
      return wasm.exportControlHtml(c.secIdx, c.paraIdx, c.controlIdx, '');
    }, kind);
    if (kind === 'table') { assert.match(exported, /첫째 셀/); assert.match(exported, /둘째 셀/); }
    else assert.match(exported, /data:image\/png;base64,/);
    console.log(`${kind}: 새 문서에서 독립 데이터 복원 통과`);
  }
  // F3 블록 선택 처리와 Ctrl+F3 상용구 목록의 충돌을 실제 키 입력으로 검사한다.
  await page.evaluate(() => window.__autotextQA.getInputHandler().focus());
  await page.keyboard.down('Control'); await page.keyboard.press('F3'); await page.keyboard.up('Control');
  await page.waitForSelector('.modal-overlay');
  assert.match(await page.$eval('.dialog-title', node => node.textContent), /상용구 내용/);
  console.log('Ctrl+F3 목록 열기 통과');
} finally { await browser.disconnect(); }
