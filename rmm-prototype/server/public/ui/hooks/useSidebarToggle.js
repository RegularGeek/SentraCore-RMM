/*
  SentraCore Design System v1.0 — hooks/useSidebarToggle
  Wires a hamburger/menu button to open/close .sc-sidebar on small screens,
  and auto-collapses below the 900px breakpoint used in navigation.css.

  Usage:
    SC.useSidebarToggle({ sidebar: el.sidebar, toggleBtn: el.sidebarToggleBtn });
*/
window.SC = window.SC || {};

SC.useSidebarToggle = function useSidebarToggle({ sidebar, toggleBtn }) {
  if (!sidebar) return;

  function open() {
    sidebar.classList.add("is-open");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "true");
  }
  function close() {
    sidebar.classList.remove("is-open");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
  }
  function toggle() {
    sidebar.classList.contains("is-open") ? close() : open();
  }

  if (toggleBtn) toggleBtn.addEventListener("click", toggle);

  SC.useMediaQuery("(max-width: 900px)", (isSmall) => {
    if (!isSmall) close();
  });

  return { open, close, toggle };
};
