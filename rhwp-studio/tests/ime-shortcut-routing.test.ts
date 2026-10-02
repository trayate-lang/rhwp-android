import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/engine/input-handler-keyboard.ts', import.meta.url),
  'utf8',
);

test('IME 조합 분기는 수정키와 기능키 단축키의 조합을 먼저 마감한다', () => {
  const imeStart = source.indexOf('if (this.isComposing || e.isComposing || e.keyCode === 229) {');
  const imeEnd = source.indexOf('// [#4031]', imeStart);
  assert.ok(imeStart >= 0 && imeEnd > imeStart, 'IME 조합 분기 경계를 찾지 못했다');

  const imeBranch = source.slice(imeStart, imeEnd);
  assert.match(
    imeBranch,
    /if \(\(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey \|\| isFunctionShortcut\) && this\.dispatcher\) \{\s*const cmdId = matchShortcut\(e, defaultShortcuts\);\s*if \(cmdId\) \{\s*e\.preventDefault\(\);\s*this\.commitCompositionForCommand\(\);\s*this\.dispatcher\.dispatch\(cmdId\);\s*return;/,
  );
});
