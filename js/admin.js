// Dashboard del administrador
(function () {
  const { api, esc, toast, num } = window.App;
  const $ = (id) => document.getElementById(id);
  const ESTADOS = ['Nueva', 'Enviada a compras', 'Comprada', 'Rechazada', 'Duplicada'];
  const CLASE_ESTADO = {
    'Nueva': 'badge-blue', 'Enviada a compras': 'badge-ok', 'Comprada': 'badge-violet',
    'Rechazada': 'badge-red', 'Duplicada': 'badge-gray'
  };
  const CLASE_CORTE = { 'Pendiente de confirmar': 'badge-urg', 'Enviado (confirmado)': 'badge-ok', 'Anulado': 'badge-gray' };

  let solicitudes = [];
  let cortes = [];
  const sel = new Set();     // ids seleccionados
  const edits = {};          // { id: { cant, nota } } cambios locales aún no enviados
  let corteModal = null;     // { idCorte, gmailUrl }
  let cargando = false;

  /* ---------- Carga ---------- */
  async function cargar(silencioso) {
    if (cargando) return;
    cargando = true;
    if (!silencioso) $('btnRefrescar').disabled = true;
    try {
      const [s, c] = await Promise.all([api('listarSolicitudes'), api('listarCortes')]);
      solicitudes = s;
      cortes = c;
      // quitar de la selección lo que ya no está en Nueva
      [...sel].forEach((id) => {
        const x = solicitudes.find((r) => r.id === id);
        if (!x || x.estado !== 'Nueva') sel.delete(id);
      });
      $('errorGlobal').hidden = true;
      pintar();
    } catch (e) {
      $('errorGlobal').textContent = e.message;
      $('errorGlobal').hidden = false;
    } finally {
      cargando = false;
      $('btnRefrescar').disabled = false;
    }
  }

  async function iniciar() {
    try {
      const d = await api('init');
      if (!$('destinatario').value) $('destinatario').value = d.correoCompras || '';
    } catch (e) { /* el error se muestra al cargar */ }
    await cargar();
  }

  /* ---------- Solicitudes ---------- */
  function filtradas() {
    const q = $('fBuscar').value.trim().toLowerCase();
    const est = $('fEstado').value;
    const tipo = $('fTipo').value;
    const urg = $('fUrg').checked;
    return solicitudes.filter((r) => {
      if (est && r.estado !== est) return false;
      if (tipo && r.tipo !== tipo) return false;
      if (urg && r.pedido_detenido !== 'SI') return false;
      if (q) {
        const txt = [r.id, r.ref_interna, r.producto, r.operario, r.pedido_odoo, r.observacion].join(' ').toLowerCase();
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    }).sort((a, b) => {
      // urgentes primero dentro de las nuevas; luego más recientes
      if (a.estado === 'Nueva' && b.estado === 'Nueva') {
        const u = (b.pedido_detenido === 'SI') - (a.pedido_detenido === 'SI');
        if (u) return u;
      }
      return (b.ultimo_reporte || b.fecha_hora || 0) - (a.ultimo_reporte || a.fecha_hora || 0);
    });
  }

  function valorCant(r) { return edits[r.id] && edits[r.id].cant !== undefined ? edits[r.id].cant : (r.cant_sugerida === '' ? '' : r.cant_sugerida); }
  function valorNota(r) { return edits[r.id] && edits[r.id].nota !== undefined ? edits[r.id].nota : (r.nota_admin || ''); }

  function filaHtml(r) {
    const nueva = r.estado === 'Nueva';
    const urg = r.pedido_detenido === 'SI';
    const marcado = sel.has(r.id);
    const fisico = r.cant_fisica === '' || r.cant_fisica === null ? '–' : num(r.cant_fisica);
    return `<tr class="${marcado ? 'sel' : ''}" data-id="${esc(r.id)}">
      <td>${nueva ? `<input type="checkbox" class="chk" ${marcado ? 'checked' : ''} aria-label="Seleccionar ${esc(r.id)}">` : ''}</td>
      <td style="white-space:nowrap"><div class="cell-strong">${esc(r.id)}</div><div class="muted">${esc(r.fecha_hora_txt || '')}</div></td>
      <td style="min-width:200px"><div style="font-weight:500">${esc(r.producto)}</div><div class="muted">${esc(r.ref_interna)}</div></td>
      <td style="min-width:150px">
        <div>${esc(r.tipo)} ${urg ? '<span class="badge badge-urg">Urgente</span>' : ''}</div>
        ${r.observacion ? `<div class="muted" style="max-width:260px">${esc(r.observacion)}</div>` : ''}
      </td>
      <td style="white-space:nowrap">${esc(num(r.stock_odoo))} / ${esc(fisico)}</td>
      <td>${esc(r.pedido_odoo || '–')}</td>
      <td>${esc(r.operario)}</td>
      <td>${esc(r.reportes || 1)}</td>
      <td style="width:110px">${nueva
        ? `<input class="input in-cant" type="number" min="0" step="any" inputmode="decimal" value="${esc(valorCant(r))}" aria-label="Cantidad mínima de ${esc(r.ref_interna)}">`
        : esc(r.cant_sugerida === '' ? '–' : num(r.cant_sugerida))}</td>
      <td style="min-width:150px">${nueva
        ? `<input class="input in-nota" maxlength="300" value="${esc(valorNota(r))}" aria-label="Nota para compras de ${esc(r.ref_interna)}">`
        : esc(r.nota_admin || '–') + (r.id_corte ? `<div class="muted">${esc(r.id_corte)}</div>` : '')}</td>
      <td style="min-width:150px">
        <label class="sr-only" for="est-${esc(r.id)}">Estado de ${esc(r.id)}</label>
        <select id="est-${esc(r.id)}" class="select in-estado">
          ${ESTADOS.map((e) => `<option ${e === r.estado ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </td>
    </tr>`;
  }

  function pintar() {
    const lista = filtradas();
    $('tbody').innerHTML = lista.length
      ? lista.map(filaHtml).join('')
      : '<tr><td colspan="11" class="empty">No hay solicitudes con estos filtros.</td></tr>';

    const nuevasVisibles = lista.filter((r) => r.estado === 'Nueva');
    const todas = nuevasVisibles.length > 0 && nuevasVisibles.every((r) => sel.has(r.id));
    $('selTodas').checked = todas;
    $('selTodas').disabled = nuevasVisibles.length === 0;

    $('selN').textContent = sel.size;
    $('selbar').hidden = sel.size === 0;

    // indicadores
    const hoy = new Date().toDateString();
    $('kNuevas').textContent = solicitudes.filter((r) => r.estado === 'Nueva').length;
    $('kUrg').textContent = solicitudes.filter((r) => r.estado === 'Nueva' && r.pedido_detenido === 'SI').length;
    $('kHoy').textContent = solicitudes.filter((r) => r.fecha_envio && new Date(r.fecha_envio).toDateString() === hoy).length;
    const pendientes = cortes.filter((c) => c.estado_correo === 'Pendiente de confirmar');
    $('kPend').textContent = pendientes.length;
    const aviso = $('avisoPendientes');
    if (pendientes.length) {
      aviso.innerHTML = `Hay ${pendientes.length} ${pendientes.length === 1 ? 'corte' : 'cortes'} sin confirmar si se envió el correo: <strong>${pendientes.map((c) => esc(c.id_corte)).join(', ')}</strong>. Revísalos en <a href="#" id="irCortes">Cortes enviados</a>.`;
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }
    pintarCortes();
  }

  // Eventos de la tabla (delegados)
  $('tbody').addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.classList.contains('chk')) {
      e.target.checked ? sel.add(id) : sel.delete(id);
      tr.classList.toggle('sel', e.target.checked);
      $('selN').textContent = sel.size;
      $('selbar').hidden = sel.size === 0;
    } else if (e.target.classList.contains('in-estado')) {
      await cambiarEstado(id, e.target);
    }
  });

  $('tbody').addEventListener('input', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    edits[id] = edits[id] || {};
    if (e.target.classList.contains('in-cant')) edits[id].cant = e.target.value;
    if (e.target.classList.contains('in-nota')) edits[id].nota = e.target.value;
  });

  async function cambiarEstado(id, select) {
    const r = solicitudes.find((x) => x.id === id);
    const nuevo = select.value;
    if (!r || nuevo === r.estado) return;
    const cambios = { estado: nuevo };
    if (nuevo === 'Rechazada' || nuevo === 'Duplicada') {
      const nota = window.prompt(`Motivo para marcar ${id} como ${nuevo} (opcional):`, '');
      if (nota === null) { select.value = r.estado; return; }
      if (nota.trim()) cambios.nota_admin = nota.trim();
    }
    select.disabled = true;
    try {
      const act = await api('actualizarSolicitud', { id, cambios });
      Object.assign(r, act);
      sel.delete(id);
      toast(`${id}: ${nuevo}`);
      pintar();
    } catch (err) {
      select.value = r.estado;
      toast(err.message, 'error');
    } finally {
      select.disabled = false;
    }
  }

  $('selTodas').addEventListener('change', (e) => {
    filtradas().filter((r) => r.estado === 'Nueva').forEach((r) => (e.target.checked ? sel.add(r.id) : sel.delete(r.id)));
    pintar();
  });

  ['fBuscar', 'fEstado', 'fTipo', 'fUrg'].forEach((id) => $(id).addEventListener(id === 'fBuscar' ? 'input' : 'change', pintar));

  /* ---------- Correo a compras ---------- */
  $('btnGuardarCorreo').addEventListener('click', async () => {
    const correo = $('destinatario').value.trim();
    try {
      await api('guardarCorreoCompras', { correo });
      toast('Correo de compras guardado como predeterminado');
    } catch (e) { toast(e.message, 'error'); }
  });

  $('btnCorte').addEventListener('click', async () => {
    const ids = [...sel];
    if (!ids.length) return;
    const items = ids.map((id) => {
      const r = solicitudes.find((x) => x.id === id);
      return { id, ref: r ? r.ref_interna : id, cantSugerida: r ? valorCant(r) : '', nota: r ? valorNota(r) : '' };
    });
    const faltan = items.filter((i) => !(Number(i.cantSugerida) > 0));
    if (faltan.length) {
      toast('Falta la cantidad mínima en: ' + faltan.map((i) => i.ref).join(', '), 'error');
      const tr = document.querySelector(`tr[data-id="${CSS.escape(faltan[0].id)}"] .in-cant`);
      if (tr) tr.focus();
      return;
    }
    const destinatario = $('destinatario').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinatario)) {
      toast('Escribe un correo de compras válido', 'error');
      $('destinatario').focus();
      return;
    }

    // Abrir la pestaña ya (en el clic) para que el navegador no la bloquee
    const pestana = window.open('about:blank', '_blank');
    const btn = $('btnCorte');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Creando…';
    try {
      const r = await api('crearCorte', {
        destinatario,
        items: items.map((i) => ({ id: i.id, cantSugerida: Number(i.cantSugerida), nota: i.nota }))
      });
      if (pestana) pestana.location.href = r.gmailUrl;
      else window.open(r.gmailUrl, '_blank');
      ids.forEach((id) => { sel.delete(id); delete edits[id]; });
      abrirModal(r.idCorte, r.gmailUrl, r.destinatario, items.length);
      await cargar(true);
    } catch (e) {
      if (pestana) pestana.close();
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear correo a compras';
    }
  });

  function urlGmail(to, asunto, cuerpo) {
    return 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to) +
      '&su=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(cuerpo);
  }

  /* ---------- Modal de confirmación ---------- */
  function abrirModal(idCorte, gmailUrl, destinatario, n) {
    corteModal = { idCorte, gmailUrl };
    $('mcTitulo').textContent = `¿Enviaste el correo del ${idCorte}?`;
    $('mcTexto').textContent = `Se abrió Gmail con ${n ? n + ' producto' + (n === 1 ? '' : 's') : 'el resumen'} para ${destinatario}. Confirma cuando le hayas dado Enviar; así queda el respaldo.`;
    $('modalConfirmar').hidden = false;
    $('mcSi').focus();
  }
  function cerrarModal() { $('modalConfirmar').hidden = true; corteModal = null; }

  $('mcSi').addEventListener('click', () => confirmar(corteModal && corteModal.idCorte, true));
  $('mcAbrir').addEventListener('click', () => { if (corteModal) window.open(corteModal.gmailUrl, '_blank'); });
  $('mcNo').addEventListener('click', () => anular(corteModal && corteModal.idCorte, true));
  $('mcLuego').addEventListener('click', cerrarModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modalConfirmar').hidden) cerrarModal(); });

  async function confirmar(idCorte, desdeModal) {
    if (!idCorte) return;
    try {
      await api('confirmarCorte', { idCorte });
      toast(`${idCorte} confirmado como enviado`);
      if (desdeModal) cerrarModal();
      await cargar(true);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function anular(idCorte, desdeModal) {
    if (!idCorte) return;
    if (!window.confirm(`¿Anular el ${idCorte}? Sus solicitudes vuelven a "Nueva".`)) return;
    try {
      await api('anularCorte', { idCorte });
      toast(`${idCorte} anulado`);
      if (desdeModal) cerrarModal();
      await cargar(true);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ---------- Cortes ---------- */
  function pintarCortes() {
    const q = $('fCorte').value.trim().toLowerCase();
    const lista = cortes.filter((c) => !q || [c.id_corte, c.resumen, c.destinatario, c.ids_solicitudes].join(' ').toLowerCase().indexOf(q) >= 0);
    if (!lista.length) {
      $('listaCortes').innerHTML = `<div class="empty">${cortes.length ? 'Ningún corte coincide con la búsqueda.' : 'Aún no se ha enviado ningún corte a compras.'}</div>`;
      return;
    }
    $('listaCortes').innerHTML = lista.map((c) => {
      const pend = c.estado_correo === 'Pendiente de confirmar';
      return `<div class="corte" data-corte="${esc(c.id_corte)}">
        <div class="corte-head">
          <div>
            <div style="font-weight:600">${esc(c.id_corte)} · ${esc(c.cantidad_items)} producto${Number(c.cantidad_items) === 1 ? '' : 's'}</div>
            <div class="muted">${esc(c.fecha_hora_txt || '')} · para ${esc(c.destinatario)}${c.fecha_confirmacion_txt ? ' · ' + (c.estado_correo === 'Anulado' ? 'anulado' : 'confirmado') + ' el ' + esc(c.fecha_confirmacion_txt) : ''}</div>
          </div>
          <span class="badge ${CLASE_CORTE[c.estado_correo] || 'badge-gray'}">${esc(c.estado_correo)}</span>
        </div>
        <details><summary style="cursor:pointer;font-size:14px">Ver resumen enviado</summary><pre>${esc(c.resumen)}</pre></details>
        <div class="actions">
          <button class="btn btn-sm act-gmail" type="button">Abrir en Gmail</button>
          ${pend ? '<button class="btn btn-sm btn-primary act-confirmar" type="button">Confirmar enviado</button><button class="btn btn-sm btn-danger act-anular" type="button">Anular</button>' : ''}
        </div>
      </div>`;
    }).join('');
  }

  $('listaCortes').addEventListener('click', (e) => {
    const card = e.target.closest('[data-corte]');
    if (!card) return;
    const c = cortes.find((x) => x.id_corte === card.dataset.corte);
    if (!c) return;
    if (e.target.classList.contains('act-gmail')) window.open(urlGmail(c.destinatario, c.asunto, c.resumen), '_blank');
    if (e.target.classList.contains('act-confirmar')) confirmar(c.id_corte, false);
    if (e.target.classList.contains('act-anular')) anular(c.id_corte, false);
  });
  $('fCorte').addEventListener('input', pintarCortes);

  /* ---------- Pestañas ---------- */
  function mostrarTab(cual) {
    const sol = cual === 'sol';
    $('tabSol').setAttribute('aria-selected', String(sol));
    $('tabCortes').setAttribute('aria-selected', String(!sol));
    $('panelSol').hidden = !sol;
    $('panelCortes').hidden = sol;
  }
  $('tabSol').addEventListener('click', () => mostrarTab('sol'));
  $('tabCortes').addEventListener('click', () => mostrarTab('cortes'));
  document.addEventListener('click', (e) => {
    if (e.target.id === 'irCortes') { e.preventDefault(); mostrarTab('cortes'); }
  });

  /* ---------- Actualización ---------- */
  $('btnRefrescar').addEventListener('click', () => cargar());
  setInterval(() => {
    const ocupado = sel.size > 0 || !$('modalConfirmar').hidden ||
      (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
    if (!document.hidden && !ocupado) cargar(true);
  }, 60000);

  iniciar();
})();
