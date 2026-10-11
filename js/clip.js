// Clipboard with a fallback for browsers that refuse the async API.
// With html, the copy carries formatting and the plain text as a fallback.
export async function copyText(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } else await navigator.clipboard.writeText(text);
  } catch {
    if (html) {
      const d = document.createElement('div');
      d.contentEditable = 'true';
      d.innerHTML = html;
      document.body.append(d);
      const r = document.createRange();
      r.selectNodeContents(d);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('copy');
      getSelection().removeAllRanges();
      d.remove();
      return;
    }
    const t = document.createElement('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

// A short flash on whatever was copied, in place of a message
export function flash(node) {
  node.classList.remove('copied');
  void node.offsetWidth;
  node.classList.add('copied');
  setTimeout(() => node.classList.remove('copied'), 900);
}
