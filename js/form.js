// Formulario del operario
(function () {
  const { api, esc, toast, num } = window.App;
  const $ = (id) => document.getElementById(id);

  const el = {
    form: $('vistaForm'), ok: $('vistaOk'),
    operario: $('operario'), ref: $('ref'), btnBuscar: $('btnBuscar'),
    resultados: $('resultados'), detalle: $('bloqueDetalle'),
    cantFisica: $('cantFisica'), pedido: $('pedido'), detenido: $('detenido'), observacion: $('observacion'),
    btnEnviar: $('btnEnviar'), errorForm: $('errorForm'), errorInit: $('errorInit'),
    okTitulo: $('okTitulo'), okSub: $('okSub'), okResumen: $('okResumen'), btnOtro: $('btnOtro')
  };

  let producto = null;     // producto seleccionado
  let ultimaBusqueda = []; // resultados de la última búsqueda
  let enviando = false;

  /* ---------- Inicio ---------- */
  async function iniciar() {
    try {
      const d = await api('init');
      const guardado = localStorage.getItem('operario') || '';
      el.operario.innerHTML = '<option value="">Selecciona tu nombre</option>' +
        d.operarios.map((n) => `<option ${n === guardado ? 'selected' : ''}>${esc(n)}</option>`).join('');
    } catch (e) {
      el.operario.innerHTML = '<option value="">Sin datos</option>';
      el.errorInit.textContent = e.message;
      el.errorInit.hidden = false;
    }
  }

  el.operario.addEventListener('change', () => {
    localStorage.setItem('operario', el.operario.value);
    actualizarBoton();
  });

  /* ---------- Búsqueda ---------- */
  async function buscar() {
    const ref = el.ref.value.trim();
    if (ref.length < 2) { el.ref.focus(); return; }
    seleccionar(null);
    el.btnBuscar.disabled = true;
    el.btnBuscar.innerHTML = '<span class="spinner" aria-hidden="true"></span><span class="sr-only">Buscando</span>';
    el.resultados.innerHTML = '';
    try {
      const d = await api('buscarProducto', { ref });
      ultimaBusqueda = d.productos;
      if (!d.productos.length) {
        el.resultados.innerHTML = `<div class="alert alert-warn">No se encontró ningún producto con la referencia <strong>${esc(ref)}</strong>. Revisa que esté bien escrita.</div>`;
      } else if (d.exacto && d.productos.length === 1) {
        seleccionar(d.productos[0]);
      } else {
        el.resultados.innerHTML =
          `<div class="label" style="margin-bottom:8px">${d.exacto ? 'Varios productos con esa referencia' : 'No hay coincidencia exacta. ¿Es alguno de estos?'}</div>` +
          '<div class="result-list">' +
          d.productos.map((p, i) => `
            <button type="button" class="result-item" data-i="${i}">
              <span style="font-weight:600">${esc(p.nombre)}</span>
              <span class="muted">${esc(p.ref)} · Stock Odoo: ${esc(num(p.stock))} ${esc(p.unidad)}</span>
            </button>`).join('') +
          '</div>';
      }
    } catch (e) {
      el.resultados.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    } finally {
      el.btnBuscar.disabled = false;
      el.btnBuscar.textContent = 'Buscar';
    }
  }

  el.btnBuscar.addEventListener('click', buscar);
  el.ref.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); buscar(); }
  });
  el.resultados.addEventListener('click', (e) => {
    const b = e.target.closest('.result-item');
    if (b) seleccionar(ultimaBusqueda[Number(b.dataset.i)]);
  });

  function seleccionar(p) {
    producto = p;
    el.detalle.disabled = !p;
    if (p) {
      el.resultados.innerHTML = `
        <div class="card product">
          <div class="product-head">
            <div>
              <div class="product-name">${esc(p.nombre)}</div>
              <div class="muted">${esc(p.ref)}${p.unidad ? ' · ' + esc(p.unidad) : ''}</div>
            </div>
            <span class="badge badge-ok">Encontrado</span>
          </div>
          <div class="muted">Stock en Odoo: <strong style="color:var(--ink)">${esc(num(p.stock))} ${esc(p.unidad)}</strong></div>
        </div>
        ${p.abierta ? `<div class="alert alert-info" style="margin-top:10px">Este producto ya fue reportado (${esc(p.abierta.id)}, ${p.abierta.reportes} ${p.abierta.reportes === 1 ? 'vez' : 'veces'}). Tu reporte se suma a esa solicitud.</div>` : ''}`;
    }
    actualizarBoton();
  }

  /* ---------- Envío ---------- */
  el.form.addEventListener('change', actualizarBoton);

  function tipoSeleccionado() {
    const r = el.form.querySelector('input[name="tipo"]:checked');
    return r ? r.value : '';
  }

  function actualizarBoton() {
    el.btnEnviar.disabled = enviando || !(el.operario.value && producto && tipoSeleccionado());
  }

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.errorForm.hidden = true;
    if (!el.operario.value) return mostrarError('Selecciona tu nombre.');
    if (!producto) return mostrarError('Busca y selecciona el producto.');
    if (!tipoSeleccionado()) return mostrarError('Indica qué pasa con el producto.');

    enviando = true;
    actualizarBoton();
    el.btnEnviar.innerHTML = '<span class="spinner" aria-hidden="true"></span> Enviando…';
    try {
      const datos = {
        operario: el.operario.value,
        productId: producto.id,
        tipo: tipoSeleccionado(),
        cantFisica: el.cantFisica.value.trim(),
        pedido: el.pedido.value.trim(),
        pedidoDetenido: el.detenido.checked,
        observacion: el.observacion.value.trim()
      };
      const r = await api('crearSolicitud', datos);
      mostrarConfirmacion(r, datos);
    } catch (err) {
      mostrarError(err.message);
    } finally {
      enviando = false;
      el.btnEnviar.textContent = 'Solicitar compra';
      actualizarBoton();
    }
  });

  function mostrarError(msg) {
    el.errorForm.textContent = msg;
    el.errorForm.hidden = false;
    el.errorForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function mostrarConfirmacion(r, d) {
    el.okTitulo.textContent = r.sumada ? 'Reporte sumado' : 'Solicitud enviada';
    el.okSub.textContent = r.sumada
      ? `Ya existía una solicitud para este producto; ahora tiene ${r.reportes} reportes.`
      : 'El administrador ya la ve en su bandeja.';
    const filas = [
      ['Número', `<strong>${esc(r.id)}</strong>`],
      ['Producto', esc(r.producto.nombre)],
      ['Referencia', esc(r.producto.ref)],
      ['Novedad', esc(d.tipo) + (d.cantFisica !== '' ? ` · quedan ${esc(d.cantFisica)}` : '')],
      ['Operario', esc(d.operario)]
    ];
    if (d.pedido) filas.push(['Pedido', esc(d.pedido.toUpperCase())]);
    if (d.pedidoDetenido) filas.push(['Prioridad', '<span class="badge badge-urg">Urgente</span>']);
    el.okResumen.innerHTML = filas.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('');
    el.form.hidden = true;
    el.ok.hidden = false;
    window.scrollTo(0, 0);
  }

  el.btnOtro.addEventListener('click', () => {
    el.form.reset();
    // conservar el operario
    el.operario.value = localStorage.getItem('operario') || '';
    seleccionar(null);
    el.resultados.innerHTML = '';
    el.errorForm.hidden = true;
    el.ok.hidden = true;
    el.form.hidden = false;
    el.ref.focus();
  });

  /* ---------- PWA: instalación ---------- */
  const btnInstalar = $('btnInstalar');
  let eventoInstalar = null;
  const esStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const esIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    eventoInstalar = e;
    btnInstalar.hidden = false;
  });
  if (esIos && !esStandalone) btnInstalar.hidden = false;

  btnInstalar.addEventListener('click', async () => {
    if (eventoInstalar) {
      eventoInstalar.prompt();
      const r = await eventoInstalar.userChoice;
      if (r.outcome === 'accepted') btnInstalar.hidden = true;
      eventoInstalar = null;
    } else if (esIos) {
      $('ayudaIos').hidden = false;
    }
  });
  $('cerrarIos').addEventListener('click', () => { $('ayudaIos').hidden = true; });
  window.addEventListener('appinstalled', () => { btnInstalar.hidden = true; toast('Aplicación instalada'); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  iniciar();
})();
