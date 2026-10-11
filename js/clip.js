// Clipboard with a fallback for browsers that refuse the async API
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
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
