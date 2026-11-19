// Feature'lar kendi action'larını buraya kaydeder; app.js elle bind yapmaz.
const actions = new Map();
let started = false;

export function registerAction(name, handler) {
  if (!actions.has(name)) actions.set(name, new Set());
  actions.get(name).add(handler);
  return () => actions.get(name)?.delete(handler);
}

//! event.target bazen metin düğümü olabilir; closest güvenli olsun diye Element kontrolü.
function closestAction(target) {
  return target instanceof Element ? target.closest("[data-action]") : null;
}

export function setupActionDelegation() {
  if (started) return;
  started = true;
  document.addEventListener("click", (event) => {
    const element = closestAction(event.target);
    if (!element) return;
    const handlers = actions.get(element.dataset.action);
    if (!handlers) return;
    [...handlers].forEach((handler) => {
      try {
        handler(element, event);
      } catch (error) {
        console.error(`[events] ${element.dataset.action} hatası:`, error);
      }
    });
  });
}
