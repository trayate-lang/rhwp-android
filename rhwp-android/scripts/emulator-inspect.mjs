/** 내 디버그 APK의 문서 상태를 검사한다. 실제 키보드/SAF 검사는 별도로 병행한다. */
import puppeteer from '../../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const browser = await puppeteer.connect({ browserURL: process.env.RHWP_CDP_URL || 'http://127.0.0.1:9223', defaultViewport: null });
try {
  const pages = await browser.pages();
  const page = pages.find(p => p.url().endsWith('/assets/studio/index.html'));
  if (!page) throw new Error('rHWP Fold 테스트 화면을 찾지 못했습니다.');
  const result = await page.evaluate(() => {
    const automation = window.rhwpStudio.automation;
    if (!window.__androidQA) {
      // 원본의 공식 확장 명령에서 서비스를 받아 읽기 관찰에만 사용한다.
      automation.registerCommand({ id: 'ext:android-qa', label: 'QA', execute(services) { window.__androidQA = { services }; } });
      automation.execute('ext:android-qa'); automation.unregisterCommand('ext:android-qa');
    }
    const { services } = window.__androidQA;
    const context = automation.getContext();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      context,
      cursor: services.getInputHandler()?.cursor.getPosition(),
      text: services.wasm.getTextRange(0, 0, 0, 500),
      statusbar: document.getElementById('status-bar')?.getBoundingClientRect().toJSON(),
      bottomBar: document.querySelector('.rhwp-android-bar')?.getBoundingClientRect().toJSON(),
    };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.disconnect(); }
