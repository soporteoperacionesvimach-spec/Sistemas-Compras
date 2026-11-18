// Cliente del Web App de Apps Script + utilidades compartidas.
(function () {
  async function api(action, datos) {
    const cfg = window.APP_CONFIG || {};
    if (!cfg.API_URL || cfg.API_URL.indexOf('PEGA_AQUI') === 0) {
      throw new Error('Falta configurar la URL del Web App en js/config.js');
    }
    let res;
    try {
      // text/plain evita la verificación CORS previa, que Apps Script no admite
      res = await fetch(cfg.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action, token: cfg.API_TOKEN || '' }, datos || {}))
      });
    } catch (e) {
      throw new Error(navigator.onLine ? 'No se pudo conectar con el servidor. Intenta de nuevo.' : 'Sin conexión a internet.');
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('El servidor respondió algo inesperado.'); }
    if (!json.ok) throw new Error(json.error || 'Error desconocido');
    return json.data;
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let toastTimer = null;
  function toast(msg, tipo) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.className = 'toast' + (tipo === 'error' ? ' error' : '');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, tipo === 'error' ? 6000 : 3500);
  }

  function num(v) {
    if (v === '' || v === null || v === undefined) return '';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  }

  window.App = { api: api, esc: esc, toast: toast, num: num };
})();
