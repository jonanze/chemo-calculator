// Light/dark switch. With no saved choice the app follows the system theme;
// a click saves the opposite of whatever is showing.
const root = document.documentElement;
const system = matchMedia('(prefers-color-scheme: dark)');

const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : system.matches);
const sync = () => root.toggleAttribute('data-dark', isDark());

document.getElementById('theme').addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('cc.theme', root.dataset.theme); } catch { /* storage unavailable */ }
  sync();
});
system.addEventListener('change', sync);
sync();
