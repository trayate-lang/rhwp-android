/** 내보내기 HTML의 소스 들여쓰기를 문서의 줄바꿈과 구별한다. 기존 저장 상용구에도 적용한다. */
export function normalizeAutotextHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script,style').forEach(node => node.remove());
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
  const remove: Node[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    // pre의 실제 공백과 일반 문장 안의 공백은 보존한다. br/p 경계도 그대로 둔다.
    if (node.nodeType === Node.COMMENT_NODE ||
        (!node.parentElement?.closest('pre,textarea') && /^[\t \r\n]*[\r\n][\t \r\n]*$/.test(node.textContent || ''))) {
      remove.push(node);
    }
  }
  remove.forEach(node => node.parentNode?.removeChild(node));
  return parsed.body.innerHTML;
}
