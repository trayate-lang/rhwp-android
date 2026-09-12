import test from 'node:test';
import assert from 'node:assert/strict';
import { matchAutotext, validateAutotext, type AutotextEntry } from '../src/core/autotext-store.ts';
import { matchShortcut, defaultShortcuts } from '../src/command/shortcut-map.ts';

/** 준말이 겹치거나 한글 IME가 영문 key를 주지 않는 실제 실패 조건을 검사한다. */
const entry = (keyword: string): AutotextEntry => ({ keyword, description: '', kind: 'text', text: '시험 문장', html: '' });
test('상용구: 커서 앞의 가장 긴 준말만 치환 대상으로 삼는다', () => {
  assert.equal(matchAutotext('보고서 결재', [entry('재'), entry('결재')])?.keyword, '결재');
  assert.equal(matchAutotext('결재 후', [entry('결재')]), undefined);
});
test('상용구: 빈 준말·공백·길이 초과·없는 서식은 저장을 거부한다', () => {
  for (const keyword of ['', '두 단어', '가'.repeat(11)]) assert.throws(() => validateAutotext(entry(keyword)));
  assert.throws(() => validateAutotext({ ...entry('서식'), kind: 'body' }));
  assert.doesNotThrow(() => validateAutotext(entry('보고1')));
});
test('상용구: Alt+i와 한글 물리 I 키, Ctrl+F3를 명령에 연결한다', () => {
  const keyboard = (key: string, code: string, altKey = false, ctrlKey = false) =>
    ({ key, code, altKey, ctrlKey, metaKey: false, shiftKey: false }) as KeyboardEvent;
  assert.equal(matchShortcut(keyboard('i', 'KeyI', true), defaultShortcuts), 'insert:autotext');
  assert.equal(matchShortcut(keyboard('ㅑ', 'KeyI', true), defaultShortcuts), 'insert:autotext');
  assert.equal(matchShortcut(keyboard('F3', 'F3', false, true), defaultShortcuts), 'insert:autotext-list');
});
