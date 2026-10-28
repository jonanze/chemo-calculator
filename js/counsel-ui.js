import { PRESETS } from './counsel-data.js';
import { toxicities, note } from './counsel.js';
import { copyText, flash } from './clip.js';

// Nothing here is stored: the note lives on screen only.
const $ = (sel) => document.querySelector(sel);
const form = $('#counsel-inputs');
const out = $('#cn-note');
const TIERS = [['common', 'Common'], ['serious', 'Serious'], ['rare', 'Rare but significant']];
let off = new Set();

for (const [i, p] of PRESETS.entries()) $('#cn-regimen').add(new Option(p.name, i));

const preset = () => PRESETS[$('#cn-regimen').value];

function renderTox() {
  const box = $('#cn-tox');
  box.replaceChildren();
  const p = preset();
  if (!p) return;
  const tox = toxicities(p.drugs);
  for (const [tier, title] of TIERS) {
    if (!tox[tier].length) continue;
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    for (const x of tox[tier]) {
      const li = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !off.has(x.t);
      box.addEventListener('change', () => { box.checked ? off.delete(x.t) : off.add(x.t); render(); });
      const by = document.createElement('span');
      by.className = 'by';
      by.textContent = x.by.join(', ');
      const label = document.createElement('label');
      label.append(box, ` ${x.t}`);
      li.append(label, by);
      ul.append(li);
    }
    box.append(h, ul);
  }
}

function render() {
  const state = Object.fromEntries([...form.elements].filter((e) => e.id).map((e) => [e.id.slice(3), e.type === 'checkbox' ? e.checked : e.value]));
  out.value = note({ ...state, preset: preset(), off });
  const n = out.value.trim() ? out.value.trim().split(/\s+/).length : 0;
  $('#cn-words').textContent = `${n} words`;
}

$('#cn-regimen').addEventListener('change', () => {
  const p = preset();
  off = new Set();
  $('#cn-name').value = p?.name || '';
  $('#cn-schedule').value = p?.schedule || '';
  renderTox();
  render();
});
form.addEventListener('input', render);
out.addEventListener('input', () => {
  const n = out.value.trim() ? out.value.trim().split(/\s+/).length : 0;
  $('#cn-words').textContent = `${n} words`;
});
$('#cn-copy').addEventListener('click', async () => { await copyText(out.value); flash($('#cn-copy')); });
render();
