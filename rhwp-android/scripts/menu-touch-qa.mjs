/**
 * 디버그 APK에서 실제 터치 이벤트로 상단 메뉴를 검증한다.
 * 실행 전 문서를 열고 ADB로 WebView CDP를 localhost:9223에 연결한다.
 * 파일 내용을 변경하지 않으며, 메뉴 노출·포커스·연속 전환 실패를 오류로 반환한다.
 */
import assert from 'node:assert/strict';
import puppeteer from '../../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const browser = await puppeteer.connect({
  browserURL: process.env.RHWP_CDP_URL || 'http://127.0.0.1:9223',
  defaultViewport: null,
});
try {
  const page = (await browser.pages()).find(p => p.url().endsWith('/assets/studio/index.html'));
  assert.ok(page, '실행 중인 디버그 편집기 화면이 필요합니다.');
  // 키보드 입력 중 메뉴를 누르는 사용자의 실제 순서를 재현한다.
  await page.evaluate(() => document.querySelector('textarea[aria-label="문서 편집 입력"]')?.focus());
  for (const name of ['file', 'edit', 'view', 'insert']) {
    const selector = `.menu-item[data-menu="${name}"] > .menu-title`;
    // 스크린샷 추측 좌표 대신 실제 DOM 경계에서 터치 위치를 계산한다.
    const point = await page.$eval(selector, element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(menu => document.querySelector('.menu-item.open')?.dataset.menu === menu, {}, name);
    const state = await page.evaluate(() => {
      const dropdown = document.querySelector('.menu-item.open > .menu-dropdown');
      const item = dropdown?.querySelector('.md-item');
      const rect = item?.getBoundingClientRect();
      const hit = rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        inputFocused: document.activeElement?.matches('textarea, input, [contenteditable="true"]'),
        itemTouchable: !!hit && !!dropdown?.contains(hit),
      };
    });
    assert.equal(state.inputFocused, false, `${name}: 문서 입력 포커스가 남았습니다.`);
    assert.equal(state.itemTouchable, true, `${name}: 메뉴 항목이 가려져 있습니다.`);
    console.log(`${name}: 터치 열기, 연속 메뉴 전환, 입력 포커스 해제, 항목 노출 통과`);
  }
  await page.keyboard.press('Escape');
} finally {
  await browser.disconnect();
}
