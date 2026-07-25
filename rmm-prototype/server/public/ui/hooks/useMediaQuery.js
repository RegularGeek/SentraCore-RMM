/*
  SentraCore Design System v1.0 — hooks/useMediaQuery
  Vanilla-JS equivalent of a React useMediaQuery hook: subscribe to a
  breakpoint and get called back when it changes. No framework here, so
  this is a plain function instead of an actual hook.

  Usage:
    const unsubscribe = SC.useMediaQuery("(max-width: 900px)", (matches) => {
      sidebarEl.classList.toggle("is-collapsed", matches);
    });
*/
window.SC = window.SC || {};

SC.useMediaQuery = function useMediaQuery(query, callback) {
  const mql = window.matchMedia(query);
  const handler = (e) => callback(e.matches);
  handler(mql); // fire once immediately with the current state
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
};
