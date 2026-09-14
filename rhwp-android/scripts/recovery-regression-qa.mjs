/** editing-regression-qa.mjs 직후 전용 에뮬레이터에서 실행한다. 개인 기기에는 연결하지 않는다. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import puppeteer from '../../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const adb = process.env.ADB || 'adb';
const packageName = 'io.github.trayate_lang.rhwp.debug';
const shell = (...args) => execFileSync(adb, ['-s', 'emulator-5554', 'shell', ...args], { encoding: 'utf8' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page;

/** 재시작마다 바뀌는 WebView 프로세스에 연결한다. 아직 생성 중이면 잠시 기다린다. */
async function attach() {
  const pid = shell('pidof', packageName).trim();
  execFileSync(adb, ['-s', 'emulator-5554', 'forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`]);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null });
      page = (await browser.pages()).find(p => p.url().endsWith('/assets/studio/index.html'));
      if (page) { page.setDefaultTimeout(15000); return; }
      await browser.disconnect();
    } catch { /* 시작 중에는 검사 소켓이 아직 없을 수 있다. */ }
    await pause(250);
  }
  throw new Error('에뮬레이터 WebView 시작 시간 초과');
}

async function launch(forceStop) {
  if (browser) await browser.disconnect();
  if (forceStop) shell('am', 'force-stop', packageName);
  shell('am', 'start', '-W', '-n', `${packageName}/io.github.trayate_lang.rhwp.MainActivity`);
  await attach();
}

async function probe() {
  await page.waitForFunction(() => window.rhwpStudio?.automation);
  await page.evaluate(() => {
    const a = window.rhwpStudio.automation;
    a.registerCommand({ id: 'ext:recovery-qa', label: 'QA', execute(s) { window.__recoveryQA = s; } });
    a.execute('ext:recovery-qa'); a.unregisterCommand('ext:recovery-qa');
  });
}

async function click(label) {
  await page.waitForFunction(label => [...document.querySelectorAll('.modal-overlay button')]
    .some(button => button.textContent.trim() === label), {}, label);
  await page.evaluate(label => [...document.querySelectorAll('.modal-overlay button')]
    .find(button => button.textContent.trim() === label).click(), label);
}

try {
  await attach(); await probe();
  const expected = '강제 종료 복구 시험 문장';
  // 별도 합성 문서가 준비되어 있을 때만 강제 종료한다.
  assert.equal(await page.evaluate(() => window.__recoveryQA.wasm.getTextRange(0, 0, 0, 100)), expected);
  await launch(true);
  await page.waitForSelector('.recovery-dialog');
  assert.equal((await page.$$('.recovery-dialog')).length, 1);
  await click('복구'); await probe();
  await page.waitForFunction(expected => !document.querySelector('.modal-overlay') &&
    window.__recoveryQA.documentState.isDirty() && window.__recoveryQA.wasm.getTextRange(0, 0, 0, 100) === expected, {}, expected);
  console.log('강제 종료 후 재시작: 복구 창 1개·자동 저장 문장 복원');

  // 2초씩 쉬지 않고 계속 써도 주기적 복구 저장이 실행되는지 확인한다.
  const cdp = await page.createCDPSession();
  await page.evaluate(() => window.__recoveryQA.getInputHandler().focus());
  const started = Date.now();
  while (Date.now() - started < 16500) {
    await cdp.send('Input.insertText', { text: '가' });
    assert.equal(await page.$('.recovery-dialog'), null);
    await pause(700);
  }
  const savedAt = await page.evaluate(async () => {
    const open = indexedDB.open('rhwpStudioAutosave', 1);
    const db = await new Promise(resolve => { open.onsuccess = () => resolve(open.result); });
    const req = db.transaction('drafts').objectStore('drafts').getAll();
    const rows = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); }); db.close();
    return Math.max(0, ...rows.map(row => row.savedAt));
  });
  assert.ok(savedAt >= started + 10000, '계속 입력하는 동안에도 복구 사본이 갱신되어야 한다');
  console.log('계속 입력 중 주기적 자동 저장·복구 창 재등장 없음');

  await page.evaluate(() => window.rhwpAndroid.requestBack()); await click('취소');
  assert.equal(await page.evaluate(() => window.__recoveryQA.documentState.isDirty()), true);
  assert.equal(await page.$('.recovery-dialog'), null);
  console.log('종료 취소: 수정 상태 유지·복구 창 없음');

  await page.evaluate(() => window.rhwpAndroid.requestBack()); await click('저장 안 함');
  // 실제 Activity 종료를 확인한 뒤 새 인스턴스를 시작한다.
  let closed = false;
  for (let i = 0; i < 40; i++) {
    closed = !shell('dumpsys', 'activity', 'activities').split('\n')
      .some(line => line.includes('mResumedActivity') && line.includes(packageName));
    if (closed) break;
    await pause(250);
  }
  assert.ok(closed, '정상 종료 완료');
  await launch(false); await probe();
  await page.waitForFunction(() => window.rhwpStudio.automation.getContext().hasDocument);
  assert.equal(await page.$('.recovery-dialog'), null);
  assert.equal(await page.evaluate(() => window.__recoveryQA.documentState.isDirty()), false);
  // 깨끗한 문서의 백그라운드 체크포인트도 새 복구본을 만들어서는 안 된다.
  await page.evaluate(() => window.rhwpAndroid.checkpoint());
  await launch(true); await probe();
  await page.waitForFunction(() => window.rhwpStudio.automation.getContext().hasDocument);
  assert.equal(await page.$('.recovery-dialog'), null);
  console.log('저장 안 함으로 정상 종료·재시작·깨끗한 문서 체크포인트 후 재시작: 복구 창 없음');
} finally { if (browser) await browser.disconnect(); }
