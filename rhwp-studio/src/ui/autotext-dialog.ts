import { ModalDialog } from './dialog';
import { showConfirm } from './confirm-dialog';
import { showToast } from './toast';
import { listAutotext, matchAutotext, validateAutotext, writeAutotext, type AutotextEntry } from '../core/autotext-store';
import type { CommandServices } from '../command/types';

/** 등록할 때의 선택 데이터를 고정한다. 대화상자 입력으로 문서 선택이 바뀌어도 안전하다. */
class AutotextRegisterDialog extends ModalDialog {
  private keyword!: HTMLInputElement;
  private description!: HTMLTextAreaElement;
  private preserve!: HTMLInputElement;
  private error!: HTMLElement;
  private busy = false;

  constructor(private captured: { text: string; html: string; hasObjects: boolean }) {
    super('상용구 등록', 460);
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.style.cssText = 'display:grid;gap:12px;padding:16px;max-height:65vh;overflow:auto';
    this.keyword = document.createElement('input');
    this.keyword.setAttribute('aria-label', '준말');
    this.keyword.placeholder = '준말: 공백 없이 1~10글자';
    this.keyword.value = [...this.captured.text.trim()][0] || '';
    this.description = document.createElement('textarea');
    this.description.setAttribute('aria-label', '본말 또는 설명');
    this.description.rows = 4;
    this.description.value = this.captured.text;
    const label = document.createElement('label');
    this.preserve = document.createElement('input');
    this.preserve.type = 'checkbox';
    this.preserve.checked = true;
    this.preserve.disabled = this.captured.hasObjects;
    label.append(this.preserve, ' 글자 속성 유지 (본문 상용구)');
    const help = document.createElement('p');
    help.textContent = '해제하면 입력한 글자만 저장합니다. 유지하면 선택한 내용을 저장하며 위 입력란은 설명입니다. 표·그림은 본문 상용구로 저장됩니다. 시험판: 한글 고유 개체의 완전한 보존은 아직 검증 중입니다.';
    this.error = document.createElement('p');
    this.error.setAttribute('role', 'alert');
    body.append(this.keyword, this.description, label, help, this.error);
    return body;
  }

  protected onConfirm(): boolean {
    if (!this.busy) void this.save();
    return false;
  }

  /** DB 완료 전에 창을 닫거나 성공 안내를 표시하지 않는다. 중복 준말은 명시적으로 확인한다. */
  private async save(): Promise<void> {
    this.busy = true;
    try {
      const entry: AutotextEntry = {
        keyword: this.keyword.value.trim(), description: this.description.value,
        kind: this.preserve.checked ? 'body' : 'text',
        text: this.preserve.checked ? this.captured.text : this.description.value,
        html: this.preserve.checked ? this.captured.html : '',
      };
      validateAutotext(entry);
      if ((await listAutotext()).some(item => item.keyword === entry.keyword) &&
          !await showConfirm('상용구 바꾸기', '같은 준말이 있습니다. 기존 상용구를 바꿀까요?')) return;
      await writeAutotext(entry);
      this.busy = false;
      this.hide();
      showToast({ message: '상용구를 기기에 저장했습니다.' });
    } catch (error) { this.error.textContent = String(error instanceof Error ? error.message : error); }
    finally { this.busy = false; }
  }

  override hide(): void { if (!this.busy) super.hide(); }
}

/** 모바일에서도 목록을 눌러 넣는다. 저장 HTML은 미리보기 DOM으로 실행하지 않는다. */
class AutotextListDialog extends ModalDialog {
  private list!: HTMLElement;
  private selected?: AutotextEntry;
  private filter: 'text' | 'body' = 'text';
  private error!: HTMLElement;

  constructor(private services: CommandServices, private entries: AutotextEntry[]) {
    super('상용구 내용', 460);
    if (!entries.some(entry => entry.kind === 'text')) this.filter = 'body';
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.style.cssText = 'display:grid;gap:12px;padding:16px;max-height:65vh;overflow:auto';
    const tabs = document.createElement('div');
    for (const [kind, title] of [['text', '글자 상용구'], ['body', '본문 상용구']] as const) {
      const button = document.createElement('button');
      button.textContent = title;
      button.style.minHeight = '44px';
      button.onclick = () => { this.filter = kind; this.selected = undefined; this.render(); };
      tabs.append(button);
    }
    this.list = document.createElement('div');
    this.list.style.cssText = 'display:grid;gap:8px';
    this.error = document.createElement('p');
    this.error.setAttribute('role', 'alert');
    const hint = document.createElement('p');
    hint.textContent = '항목을 선택하고 확인을 누르면 넣습니다. 새 등록: 문서에서 선택 후 Alt+i. 앱 삭제 시 상용구도 삭제됩니다.';
    const remove = document.createElement('button');
    remove.textContent = '선택한 상용구 삭제';
    remove.style.minHeight = '44px';
    remove.onclick = () => { void this.removeSelected(); };
    body.append(tabs, this.list, hint, remove, this.error);
    this.render();
    return body;
  }

  private render(): void {
    this.list.replaceChildren();
    for (const entry of this.entries.filter(item => item.kind === this.filter)) {
      const button = document.createElement('button');
      button.textContent = `${entry.keyword} — ${entry.description.slice(0,80)}`;
      button.style.cssText = 'min-height:44px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere';
      button.setAttribute('aria-pressed', String(this.selected === entry));
      button.onclick = () => { this.selected = entry; this.render(); };
      this.list.append(button);
    }
    if (!this.list.children.length) this.list.textContent = '등록된 상용구가 없습니다.';
  }

  private async removeSelected(): Promise<void> {
    const entry = this.selected;
    if (!entry || !await showConfirm('상용구 삭제', '선택한 상용구를 삭제할까요?')) return;
    try {
      await writeAutotext(entry.keyword);
      this.entries = this.entries.filter(item => item !== entry);
      this.selected = undefined;
      this.render();
    } catch { this.error.textContent = '삭제하지 못했습니다. 다시 시도해 주세요.'; }
  }

  protected onConfirm(): boolean {
    if (!this.selected) { this.error.textContent = '넣을 상용구를 선택해 주세요.'; return false; }
    try {
      this.services.getInputHandler()?.insertAutotext(this.selected.text, this.selected.html);
      return true;
    } catch (error) { this.error.textContent = String(error); return false; }
  }
}

/** 메뉴와 Alt+i의 공통 진입점: 선택이 있으면 등록, 없으면 준말을 치환한다. */
export async function runAutotext(services: CommandServices, mode: 'auto' | 'list' = 'auto'): Promise<void> {
  try {
    const input = services.getInputHandler();
    if (!input) return;
    if (mode === 'auto' && input.getAutotextContext().selected) {
      new AutotextRegisterDialog(input.captureAutotext()).show();
      return;
    }
    const entries = await listAutotext();
    if (mode === 'auto') {
      const prefix = input.getAutotextContext().prefix;
      if (prefix) {
        const entry = matchAutotext(prefix, entries);
        if (entry) { input.insertAutotext(entry.text, entry.html, entry.keyword); return; }
      }
    }
    new AutotextListDialog(services, entries).show();
  } catch (error) { showToast({ message: error instanceof Error ? error.message : String(error) }); }
}

/** 명령 원장의 Dialog 진입 규약을 따른다. 선택 여부에 따라 등록창/목록창을 결정한다. */
export class AutotextDialog {
  constructor(private services: CommandServices) {}
  show(mode: 'auto' | 'list' = 'auto'): Promise<void> { return runAutotext(this.services, mode); }
}
