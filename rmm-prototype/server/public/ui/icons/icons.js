/*
  SentraCore Design System v1.0 — Icons
  Uses Lucide (https://lucide.dev) via CDN — no build step required, which
  matches the rest of this project (vanilla JS, no bundler). Include this
  script after the Lucide CDN script and after the DOM is ready; call
  SC.icons.refresh() any time new <i data-lucide="..."> markup is injected
  (e.g. after a render() call that adds icon placeholders).

  Usage in markup:
    <i data-lucide="server" class="sc-icon-20"></i>
  Usage in template strings from app.js:
    `<i data-lucide="cpu" class="sc-icon-16"></i>`
    ... then call SC.icons.refresh() after inserting into the DOM.
*/
window.SC = window.SC || {};

SC.icons = {
  refresh() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  },
};

document.addEventListener("DOMContentLoaded", () => SC.icons.refresh());
