/*
  SentraCore Design System v1.0 — Dialog
  Usage:
    SC.dialog.confirm({
      title: "Delete alert rule?",
      body: "This can't be undone.",
      variant: "danger",          // "danger" | "default"
      confirmLabel: "Delete",
      onConfirm: () => { ... },
    });

  Accessibility: traps focus inside the dialog while open, restores focus
  to the triggering element on close, closes on ESC or backdrop click,
  and uses role="alertdialog" with aria-labelledby/aria-describedby.
*/
window.SC = window.SC || {};

(function () {
  function confirm({ title, body, variant = "default", confirmLabel = "Confirm", cancelLabel = "Cancel", onConfirm }) {
    const triggeredBy = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "sc-dialog-backdrop";
    backdrop.innerHTML = `
      <div class="sc-dialog ${variant === "danger" ? "sc-dialog--danger" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="scDialogTitle" aria-describedby="scDialogBody">
        <h3 class="sc-text-h4 sc-dialog-title" id="scDialogTitle">${escapeHtml(title)}</h3>
        <p class="sc-dialog-body" id="scDialogBody">${escapeHtml(body || "")}</p>
        <div class="sc-dialog-actions">
          <button class="sc-btn sc-btn--secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button class="sc-btn ${variant === "danger" ? "sc-btn--danger" : "sc-btn--primary"}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("is-open"));

    const dialogEl = backdrop.querySelector(".sc-dialog");
    const focusable = dialogEl.querySelectorAll("button");
    focusable[focusable.length - 1].focus();

    function close() {
      backdrop.classList.remove("is-open");
      document.removeEventListener("keydown", onKeydown);
      setTimeout(() => {
        backdrop.remove();
        if (triggeredBy && triggeredBy.focus) triggeredBy.focus();
      }, 180);
    }

    function onKeydown(e) {
      if (e.key === "Escape") return close();
      if (e.key === "Tab") {
        const items = Array.from(focusable);
        const idx = items.indexOf(document.activeElement);
        if (e.shiftKey && idx <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && idx === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    }

    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('[data-action="cancel"]').addEventListener("click", close);
    backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => {
      close();
      if (onConfirm) onConfirm();
    });
    document.addEventListener("keydown", onKeydown);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  window.SC.dialog = { confirm };
})();
