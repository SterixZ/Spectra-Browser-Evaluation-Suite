// Shared dark/light theme toggle for both pages. Applies data-theme to
// <html>, persists the choice, and calls window.onThemeChange(mode) if the
// page defines one — used to recolor Chart.js canvases, which don't pick
// up CSS variable changes on their own.
const THEME_KEY = 'bp-theme';

function getStoredTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  return saved === 'dark' ? 'dark' : 'light';
}

function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
  document.querySelectorAll('.theme-switch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === mode);
  });
  if (typeof window.onThemeChange === 'function') window.onThemeChange(mode);
}

function initThemeToggle() {
  document.querySelectorAll('.theme-switch-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeChoice));
  });
  // Sync button state to whatever the blocking head script already applied
  // (avoids a redundant onThemeChange call at load).
  const current = document.documentElement.getAttribute('data-theme') || getStoredTheme();
  document.querySelectorAll('.theme-switch-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === current);
  });
}

document.addEventListener('DOMContentLoaded', initThemeToggle);
