/*
  SentraCore Design System v1.0 — Toast
  Usage: SC.toast.show("Rule saved", { variant: "success" });
  Variants: "info" (default) | "success" | "warning" | "danger".
  Toasts are polite live-region announcements by default (role="status"),
  or role="alert" for danger/warning so screen readers interrupt for them.
*/
window.SC = window.SC || {};

(function () {
  let region = null;

  function ensureRegion() {
    if (region) return region;
    region = document.createElement("div");
    region.className = "sc-toast-region";
    document.body.appendChild(region);
    return region;
  }

  function show(message, { variant = "info", duration = 4000 } = {}) {
    const el = document.createElement("div");
    el.className = `sc-toast sc-toast--${variant}`;
    el.setAttribute("role", variant === "danger" || variant === "warning" ? "alert" : "status");
    el.innerHTML = `
      <span class="sc-toast-message sc-text-small">${escapeHtml(message)}</span>
      <button class="sc-btn sc-btn--ghost sc-btn--icon sc-btn--sm" aria-label="Dismiss notification" style="margin-left:auto;">
        <i data-lucide="x" class="sc-icon-16"></i>
      </button>
    `;
    const dismiss = () => el.remove();
    el.querySelector("button").addEventListener("click", dismiss);
    ensureRegion().appendChild(el);
    if (window.SC.icons) window.SC.icons.refresh();
    if (duration) setTimeout(dismiss, duration);
    return dismiss;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.SC.toast = { show };
})();
