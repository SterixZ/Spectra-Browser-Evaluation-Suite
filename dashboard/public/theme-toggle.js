// Shared dark/light theme toggle for all pages. Applies data-theme to
// <html>, persists the choice, and calls window.onThemeChange(mode) if the
// page defines one — used to recolor Chart.js canvases, which don't pick
// up CSS variable changes on their own.
const THEME_KEY = 'bp-theme';

function getStoredTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  return saved === 'dark' ? 'dark' : 'light';
}

function syncThemeButtons(mode) {
  document.querySelectorAll('.theme-switch-btn').forEach((btn) => {
    const selected = btn.dataset.themeChoice === mode;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', String(selected));
  });
}

function applyTheme(mode, persist = true) {
  mode = mode === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', mode);
  if (persist) { try { localStorage.setItem(THEME_KEY, mode); } catch {} }
  syncThemeButtons(mode);
  if (typeof window.onThemeChange === 'function') window.onThemeChange(mode);
}

function initThemeToggle() {
  document.querySelectorAll('.theme-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
  });
  // Sync button state to whatever the blocking head script already applied
  // (avoids a redundant onThemeChange call at load).
  const current = document.documentElement.getAttribute('data-theme') || getStoredTheme();
  syncThemeButtons(current);
}

document.addEventListener('DOMContentLoaded', initThemeToggle);
window.addEventListener('storage', (event) => {
  if (event.key === THEME_KEY || event.key === null) applyTheme(getStoredTheme(), false);
});
window.addEventListener('pageshow', () => {
  const saved = getStoredTheme();
  if (document.documentElement.getAttribute('data-theme') !== saved) applyTheme(saved, false);
});
