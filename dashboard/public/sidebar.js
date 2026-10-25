// One navigation shell for every Spectra page. Page-specific controls belong
// in the workspace, so switching pages never changes the primary navigation.
(() => {
  const sidebar = document.querySelector("[data-spectra-sidebar]");
  if (!sidebar) return;
  const pages = [
    { id: "lab", href: "/lab.html", label: "Browser benchmarks", icon: '<path d="M4 19V9m5 10V5m6 14v-7m5 7V3"/>' },
    { id: "website", href: "/benchmark.html", label: "Website tests", icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a19 19 0 0 1 0 18 19 19 0 0 1 0-18Z"/>' },
    { id: "live", href: "/", label: "Live monitor", icon: '<path d="M2 12h4l3-8 5 16 3-8h5"/>' },
  ];
  sidebar.innerHTML = `
    <a class="spectra-brand" href="/lab.html" aria-label="Spectra home">
      <span class="spectra-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Spectra<small>Browser evaluation suite</small></span>
    </a>
    <div class="spectra-nav-label">Workspace</div>
    <nav class="spectra-nav" aria-label="Main navigation"></nav>
    <div class="spectra-local"><span aria-hidden="true"></span>Running on your computer<p>Your saved tests stay on this machine.</p></div>
    <div class="spectra-nav-spacer"></div>
    <div class="spectra-appearance"><span>Appearance</span><div class="theme-switch" role="group" aria-label="Color theme">
      <button type="button" class="theme-switch-btn" data-theme-choice="light" aria-pressed="false">Light</button>
      <button type="button" class="theme-switch-btn" data-theme-choice="dark" aria-pressed="false">Dark</button>
    </div></div>`;
  const nav = sidebar.querySelector("nav");
  for (const page of pages) {
    const link = document.createElement("a");
    link.href = page.href;
    link.className = "spectra-nav-link";
    link.dataset.page = page.id;
    link.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${page.icon}</svg><span>${page.label}</span>`;
    if (sidebar.dataset.page === page.id) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }
    nav.append(link);
  }
})();
