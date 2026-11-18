/**
 * Pendientes y Compras — backend (Google Apps Script)
 *
 * Web App que recibe las peticiones del formulario del operario y del
 * dashboard del administrador (ambos en GitHub Pages), consulta Odoo y
 * guarda todo en la hoja de Google Sheets "Gestion_Compras".
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   ODOO_URL       https://tuempresa.odoo.com   (sin / al final)
 *   ODOO_DB        nombre de la base de datos de Odoo
 *   ODOO_USER      usuario (correo) de Odoo dueño de la API key
 *   ODOO_API_KEY   API key de Odoo
 *   SPREADSHEET_ID (opcional) id de la hoja; por defecto Gestion_Compras
 *   API_TOKEN      (opcional) si se define, el frontend debe enviar el mismo valor
 */

const SPREADSHEET_ID_DEFAULT = '1zFiWT7RX_NSWpVSowlf2F2jG8P4BTU-ciiNLnol3mOQ';
const TZ = 'America/Bogota';
const HOJAS = {
  SOL: 'Solicitudes',
  CORTES: 'Cortes',
  HIST: 'Historial',
  OPS: 'Operarios',
  CONF: 'Config'
};
const TIPOS = ['Agotado', 'Pocas unidades', 'Dañado', 'Referencia no coincide', 'Otro'];
const ESTADOS = ['Nueva', 'Enviada a compras', 'Comprada', 'Rechazada', 'Duplicada'];
const CORTE_PENDIENTE = 'Pendiente de confirmar';
const CORTE_ENVIADO = 'Enviado (confirmado)';
const CORTE_ANULADO = 'Anulado';
const MAX_URL_GMAIL = 7500; // más largo que esto, Gmail puede cortar el mensaje
const CAMPOS_PRODUCTO = ['id', 'name', 'default_code', 'qty_available', 'uom_id'];

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

function doGet() {
  return json_({ ok: true, app: 'Pendientes y Compras', hora: fechaTexto_(new Date()) });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    validarToken_(body.token);
    const acciones = {
      init: init_,
      buscarProducto: buscarProducto_,
      crearSolicitud: crearSolicitud_,
      listarSolicitudes: listarSolicitudes_,
      actualizarSolicitud: actualizarSolicitud_,
      crearCorte: crearCorte_,
      confirmarCorte: confirmarCorte_,
      anularCorte: anularCorte_,
      listarCortes: listarCortes_,
      guardarCorreoCompras: guardarCorreoCompras_
    };
    const fn = acciones[body.action];
    if (!fn) throw new Error('Acción no válida: ' + body.action);
    return json_({ ok: true, data: fn(body) });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: (err && err.message) || String(err) });
  }
}

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

/** Datos iniciales: operarios activos, tipos, estados y correo de compras. */
function init_() {
  const operarios = leer_(HOJAS.OPS).filas
    .filter(function (x) { return esVerdadero_(x.obj.activo); })
    .map(function (x) { return String(x.obj.nombre).trim(); })
    .filter(Boolean);
  const conf = config_();
  return {
    operarios: operarios,
    tipos: TIPOS,
    estados: ESTADOS,
    correoCompras: conf.correo_compras || ''
  };
}

/** Busca por referencia interna (default_code). Exacta primero, luego parcial. */
function buscarProducto_(b) {
  const ref = String(b.ref || '').trim();
  if (ref.length < 2) throw new Error('Escribe la referencia interna del producto');

  const cache = CacheService.getScriptCache();
  const claveCache = 'ref_' + ref.toUpperCase();
  let resultado = null;
  const enCache = cache.get(claveCache);
  if (enCache) resultado = JSON.parse(enCache);

  if (!resultado) {
    let prods = odooExec_('product.product', 'search_read',
      [[['default_code', '=ilike', ref]]], { fields: CAMPOS_PRODUCTO, limit: 5 });
    const exacto = prods.length > 0;
    if (!exacto) {
      prods = odooExec_('product.product', 'search_read',
        [[['default_code', 'ilike', ref]]], { fields: CAMPOS_PRODUCTO, limit: 10, order: 'default_code asc' });
    }
    resultado = { exacto: exacto, productos: prods.map(mapProducto_) };
    cache.put(claveCache, JSON.stringify(resultado), 300); // 5 min
  }

  // Avisar si ya hay una solicitud abierta para esa referencia
  const horas = Number(config_().horas_antiduplicado) || 24;
  const filas = leer_(HOJAS.SOL).filas;
  resultado.productos.forEach(function (p) {
    const abierta = buscarAbierta_(filas, p.ref, horas);
    p.abierta = abierta ? { id: abierta.obj.id, reportes: Number(abierta.obj.reportes) || 1 } : null;
  });
  return resultado;
}

/** Crea una solicitud o suma el reporte a una abierta de la misma referencia. */
function crearSolicitud_(b) {
  const operario = String(b.operario || '').trim();
  if (init_().operarios.indexOf(operario) < 0) throw new Error('Selecciona un operario válido');
  if (TIPOS.indexOf(b.tipo) < 0) throw new Error('Selecciona qué pasa con el producto');
  const productId = Number(b.productId);
  if (!productId) throw new Error('Primero busca y selecciona el producto');

  let cantFisica = '';
  if (b.cantFisica !== '' && b.cantFisica !== null && b.cantFisica !== undefined) {
    cantFisica = Number(b.cantFisica);
    if (isNaN(cantFisica) || cantFisica < 0) throw new Error('La cantidad en físico no es válida');
  }
  const pedido = String(b.pedido || '').trim().toUpperCase().slice(0, 40);
  const detenido = b.pedidoDetenido === true;
  const obs = String(b.observacion || '').trim().slice(0, 500);

  // Datos frescos de Odoo (stock al momento del reporte)
  const leidos = odooExec_('product.product', 'read', [[productId]], { fields: CAMPOS_PRODUCTO });
  if (!leidos.length) throw new Error('El producto ya no existe en Odoo');
  const prod = mapProducto_(leidos[0]);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const horas = Number(config_().horas_antiduplicado) || 24;
    const sol = leer_(HOJAS.SOL);
    const ahora = new Date();
    const abierta = buscarAbierta_(sol.filas, prod.ref, horas);

    if (abierta) {
      const o = abierta.obj;
      const reportes = (Number(o.reportes) || 1) + 1;
      const cambios = { reportes: reportes, ultimo_reporte: ahora, stock_odoo: prod.stock };
      if (cantFisica !== '') cambios.cant_fisica = cantFisica;
      const pedidos = String(o.pedido_odoo || '').split(/,\s*/).filter(Boolean);
      if (pedido && pedidos.indexOf(pedido) < 0) cambios.pedido_odoo = pedidos.concat(pedido).join(', ');
      if (detenido) cambios.pedido_detenido = 'SI';
      const extra = operario + ' (' + b.tipo + ')' + (obs ? ': ' + obs : '');
      cambios.observacion = o.observacion ? o.observacion + ' | ' + extra : extra;
      escribirCampos_(sol, abierta.fila, cambios);
      historial_(o.id, 'Nueva', 'Nueva', operario, 'Reporte sumado (' + reportes + ')');
      return { id: o.id, sumada: true, reportes: reportes, producto: prod };
    }

    const id = siguienteId_(sol.filas.map(function (x) { return x.obj.id; }), 'SOL-', 6);
    const fila = {
      id: id,
      fecha_hora: ahora,
      operario: operario,
      tipo: b.tipo,
      ref_interna: prod.ref,
      product_id: prod.id,
      producto: prod.nombre,
      stock_odoo: prod.stock,
      cant_fisica: cantFisica,
      pedido_odoo: pedido,
      pedido_detenido: detenido ? 'SI' : 'NO',
      observacion: obs,
      reportes: 1,
      ultimo_reporte: ahora,
      estado: 'Nueva'
    };
    sol.hoja.appendRow(filaDesdeObj_(sol.enc, fila));
    historial_(id, '', 'Nueva', operario, 'Creada');
    return { id: id, sumada: false, reportes: 1, producto: prod };
  } finally {
    lock.releaseLock();
  }
}

/** Todas las solicitudes (más recientes primero). */
function listarSolicitudes_() {
  return leer_(HOJAS.SOL).filas.map(function (x) { return serializar_(x.obj); }).reverse();
}

/** Cambia estado, cantidad sugerida o nota de una solicitud. */
function actualizarSolicitud_(b) {
  const id = String(b.id || '');
  const permitidos = ['estado', 'cant_sugerida', 'nota_admin'];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sol = leer_(HOJAS.SOL);
    const x = buscarPorCampo_(sol.filas, 'id', id);
    if (!x) throw new Error('No existe la solicitud ' + id);
    const cambios = {};
    permitidos.forEach(function (k) { if (b.cambios && b.cambios[k] !== undefined) cambios[k] = b.cambios[k]; });
    if (cambios.estado !== undefined && ESTADOS.indexOf(cambios.estado) < 0) throw new Error('Estado no válido');
    if (cambios.nota_admin !== undefined) cambios.nota_admin = String(cambios.nota_admin).slice(0, 300);
    if (!Object.keys(cambios).length) return serializar_(x.obj);
    escribirCampos_(sol, x.fila, cambios);
    if (cambios.estado !== undefined && cambios.estado !== x.obj.estado) {
      historial_(id, x.obj.estado, cambios.estado, 'Admin', cambios.nota_admin || '');
    }
    return serializar_(Object.assign({}, x.obj, cambios));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Crea un corte: registra el resumen en la hoja Cortes, pasa las solicitudes a
 * "Enviada a compras" y devuelve el enlace de Gmail con el mensaje listo.
 * items: [{ id, cantSugerida, nota }]
 */
function crearCorte_(b) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new Error('Selecciona al menos una solicitud');
  const dest = String(b.destinatario || '').trim();
  if (!esCorreo_(dest)) throw new Error('El correo de compras no es válido');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sol = leer_(HOJAS.SOL);
    const sel = items.map(function (it) {
      const x = buscarPorCampo_(sol.filas, 'id', it.id);
      if (!x) throw new Error('No existe la solicitud ' + it.id);
      if (x.obj.estado !== 'Nueva') throw new Error(it.id + ' ya no está en estado Nueva; actualiza la bandeja');
      const cant = Number(it.cantSugerida);
      if (!(cant > 0)) throw new Error('Falta la cantidad mínima de ' + x.obj.ref_interna);
      return { x: x, cant: cant, nota: String(it.nota || '').trim().slice(0, 300) };
    });
    // Urgentes (pedido detenido) primero
    sel.sort(function (a, c) { return esUrgente_(c.x.obj) - esUrgente_(a.x.obj); });

    const cortes = leer_(HOJAS.CORTES);
    const idCorte = siguienteId_(cortes.filas.map(function (f) { return f.obj.id_corte; }), 'CORTE-', 4);
    const ahora = new Date();
    const conf = config_();
    const asunto = (conf.asunto_correo || 'Solicitud de compra') + ' ' + idCorte + ' · ' +
      Utilities.formatDate(ahora, TZ, 'dd/MM/yyyy');
    const cuerpo = armarCuerpo_(idCorte, ahora, sel);
    const gmailUrl = urlGmail_(dest, asunto, cuerpo);
    if (gmailUrl.length > MAX_URL_GMAIL) {
      throw new Error('El corte es muy largo para un solo correo (' + sel.length + ' productos). Divídelo en dos.');
    }

    cortes.hoja.appendRow(filaDesdeObj_(cortes.enc, {
      id_corte: idCorte,
      fecha_hora: ahora,
      destinatario: dest,
      asunto: asunto,
      cantidad_items: sel.length,
      ids_solicitudes: sel.map(function (s) { return s.x.obj.id; }).join(', '),
      resumen: cuerpo,
      estado_correo: CORTE_PENDIENTE
    }));
    sel.forEach(function (s) {
      escribirCampos_(sol, s.x.fila, {
        estado: 'Enviada a compras',
        cant_sugerida: s.cant,
        nota_admin: s.nota,
        id_corte: idCorte,
        fecha_envio: ahora
      });
      historial_(s.x.obj.id, 'Nueva', 'Enviada a compras', 'Admin', idCorte);
    });
    return { idCorte: idCorte, asunto: asunto, cuerpo: cuerpo, destinatario: dest, gmailUrl: gmailUrl };
  } finally {
    lock.releaseLock();
  }
}

/** El admin confirma que sí envió el correo del corte. */
function confirmarCorte_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cortes = leer_(HOJAS.CORTES);
    const x = buscarPorCampo_(cortes.filas, 'id_corte', b.idCorte);
    if (!x) throw new Error('No existe el corte ' + b.idCorte);
    if (x.obj.estado_correo === CORTE_ANULADO) throw new Error('Ese corte fue anulado');
    escribirCampos_(cortes, x.fila, { estado_correo: CORTE_ENVIADO, fecha_confirmacion: new Date() });
    return { idCorte: b.idCorte, estado: CORTE_ENVIADO };
  } finally {
    lock.releaseLock();
  }
}

/** El correo no se envió: anula el corte y devuelve las solicitudes a "Nueva". */
function anularCorte_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cortes = leer_(HOJAS.CORTES);
    const x = buscarPorCampo_(cortes.filas, 'id_corte', b.idCorte);
    if (!x) throw new Error('No existe el corte ' + b.idCorte);
    if (x.obj.estado_correo === CORTE_ENVIADO) throw new Error('Ese corte ya se confirmó como enviado');
    escribirCampos_(cortes, x.fila, { estado_correo: CORTE_ANULADO, fecha_confirmacion: new Date() });

    const sol = leer_(HOJAS.SOL);
    sol.filas.forEach(function (f) {
      if (f.obj.id_corte === b.idCorte && f.obj.estado === 'Enviada a compras') {
        escribirCampos_(sol, f.fila, { estado: 'Nueva', id_corte: '', fecha_envio: '' });
        historial_(f.obj.id, 'Enviada a compras', 'Nueva', 'Admin', 'Corte ' + b.idCorte + ' anulado');
      }
    });
    return { idCorte: b.idCorte, estado: CORTE_ANULADO };
  } finally {
    lock.releaseLock();
  }
}

/** Histórico de cortes (más recientes primero). */
function listarCortes_() {
  return leer_(HOJAS.CORTES).filas.map(function (x) { return serializar_(x.obj); }).reverse();
}

/** Cambia el correo de compras por defecto (Config!correo_compras). */
function guardarCorreoCompras_(b) {
  const correo = String(b.correo || '').trim();
  if (!esCorreo_(correo)) throw new Error('El correo no es válido');
  const conf = leer_(HOJAS.CONF);
  const x = buscarPorCampo_(conf.filas, 'clave', 'correo_compras');
  if (x) escribirCampos_(conf, x.fila, { valor: correo });
  else conf.hoja.appendRow(['correo_compras', correo, 'Destinatario por defecto del correo de corte']);
  return { correo: correo };
}

/* ------------------------------------------------------------------ */
/* Correo                                                              */
/* ------------------------------------------------------------------ */

function armarCuerpo_(idCorte, fecha, sel) {
  const L = [
    'Hola, equipo de Compras:',
    '',
    'Solicitamos la compra de los siguientes productos (corte ' + idCorte + ', ' + fechaTexto_(fecha) + '):',
    ''
  ];
  let urgentes = 0;
  sel.forEach(function (s, i) {
    const o = s.x.obj;
    const urg = esUrgente_(o);
    if (urg) urgentes++;
    L.push((i + 1) + '. ' + o.ref_interna + ' · ' + o.producto);
    L.push('   Cantidad mínima: ' + s.cant);
    L.push('   Prioridad: ' + (urg ? 'URGENTE – ' + (o.pedido_odoo ? 'pedido ' + o.pedido_odoo + ' detenido' : 'pedido detenido') : 'Normal'));
    if (s.nota) L.push('   Nota: ' + s.nota);
    L.push('');
  });
  L.push('Total: ' + sel.length + ' producto' + (sel.length === 1 ? '' : 's') +
    (urgentes ? ' (' + urgentes + ' urgente' + (urgentes === 1 ? '' : 's') + ')' : ''));
  L.push('');
  L.push('Enviado desde la plataforma Pendientes y Compras.');
  return L.join('\n');
}

function urlGmail_(to, asunto, cuerpo) {
  return 'https://mail.google.com/mail/?view=cm&fs=1' +
    '&to=' + encodeURIComponent(to) +
    '&su=' + encodeURIComponent(asunto) +
    '&body=' + encodeURIComponent(cuerpo);
}

/* ------------------------------------------------------------------ */
/* Odoo (JSON-RPC con API key)                                         */
/* ------------------------------------------------------------------ */

function odooConf_() {
  const p = PropertiesService.getScriptProperties();
  const c = {
    url: String(p.getProperty('ODOO_URL') || '').replace(/\/+$/, ''),
    db: p.getProperty('ODOO_DB'),
    user: p.getProperty('ODOO_USER'),
    key: p.getProperty('ODOO_API_KEY')
  };
  if (!c.url || !c.db || !c.user || !c.key) {
    throw new Error('Faltan propiedades de Odoo en el script (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY)');
  }
  return c;
}

function odooRpc_(service, method, args) {
  const c = odooConf_();
  const res = UrlFetchApp.fetch(c.url + '/jsonrpc', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: { service: service, method: method, args: args }
    })
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Odoo respondió con error HTTP ' + code);
  const data = JSON.parse(res.getContentText());
  if (data.error) {
    const msg = (data.error.data && data.error.data.message) || data.error.message;
    throw new Error('Odoo: ' + msg);
  }
  return data.result;
}

function odooUid_() {
  const cache = CacheService.getScriptCache();
  const enCache = cache.get('odoo_uid');
  if (enCache) return Number(enCache);
  const c = odooConf_();
  const uid = odooRpc_('common', 'login', [c.db, c.user, c.key]);
  if (!uid) throw new Error('Odoo rechazó el usuario o la API key');
  cache.put('odoo_uid', String(uid), 21600);
  return uid;
}

function odooExec_(model, method, args, kwargs) {
  const c = odooConf_();
  return odooRpc_('object', 'execute_kw', [c.db, odooUid_(), c.key, model, method, args, kwargs || {}]);
}

function mapProducto_(p) {
  return {
    id: p.id,
    ref: p.default_code || '',
    nombre: p.name,
    stock: p.qty_available,
    unidad: Array.isArray(p.uom_id) ? p.uom_id[1] : ''
  };
}

/* ------------------------------------------------------------------ */
/* Hoja de cálculo                                                     */
/* ------------------------------------------------------------------ */

function libro_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || SPREADSHEET_ID_DEFAULT;
  return SpreadsheetApp.openById(id);
}

function leer_(nombre) {
  const hoja = libro_().getSheetByName(nombre);
  if (!hoja) throw new Error('No existe la hoja ' + nombre);
  const valores = hoja.getDataRange().getValues();
  const enc = valores.shift().map(String);
  const filas = [];
  valores.forEach(function (f, i) {
    if (f[0] === '' || f[0] === null) return;
    const obj = {};
    enc.forEach(function (c, j) { obj[c] = f[j]; });
    filas.push({ fila: i + 2, obj: obj });
  });
  return { hoja: hoja, enc: enc, filas: filas };
}

function filaDesdeObj_(enc, o) {
  return enc.map(function (c) {
    const v = o[c];
    // ref_interna y pedido_odoo tienen formato de texto en la hoja (conserva ceros: 00123)
    return (v === undefined || v === null) ? '' : v;
  });
}

function escribirCampos_(tabla, fila, cambios) {
  Object.keys(cambios).forEach(function (k) {
    const col = tabla.enc.indexOf(k);
    if (col < 0) throw new Error('No existe la columna ' + k + ' en ' + tabla.hoja.getName());
    tabla.hoja.getRange(fila, col + 1).setValue(cambios[k]);
  });
}

function buscarPorCampo_(filas, campo, valor) {
  for (let i = 0; i < filas.length; i++) {
    if (String(filas[i].obj[campo]) === String(valor)) return filas[i];
  }
  return null;
}

function buscarAbierta_(filas, ref, horas) {
  if (!ref) return null;
  const limite = Date.now() - horas * 3600 * 1000;
  const r = String(ref).trim().toUpperCase();
  for (let i = filas.length - 1; i >= 0; i--) {
    const o = filas[i].obj;
    if (o.estado === 'Nueva' && String(o.ref_interna).trim().toUpperCase() === r) {
      if (fechaMs_(o.ultimo_reporte || o.fecha_hora) >= limite) return filas[i];
    }
  }
  return null;
}

function config_() {
  const c = {};
  leer_(HOJAS.CONF).filas.forEach(function (x) { c[x.obj.clave] = x.obj.valor; });
  return c;
}

function historial_(id, anterior, nuevo, usuario, nota) {
  libro_().getSheetByName(HOJAS.HIST).appendRow([new Date(), id, anterior || '', nuevo || '', usuario || '', nota || '']);
}

function siguienteId_(ids, prefijo, ancho) {
  let max = 0;
  ids.forEach(function (v) {
    const m = String(v).match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefijo + String(max + 1).padStart(ancho, '0');
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function validarToken_(t) {
  const esperado = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (esperado && t !== esperado) throw new Error('No autorizado');
}

function serializar_(o) {
  const r = {};
  Object.keys(o).forEach(function (k) {
    const v = o[k];
    if (v instanceof Date) {
      r[k] = v.getTime();
      r[k + '_txt'] = fechaTexto_(v);
    } else {
      r[k] = v;
    }
  });
  return r;
}

function fechaTexto_(d) {
  return Utilities.formatDate(d, TZ, 'dd/MM/yyyy h:mm a');
}

function fechaMs_(v) {
  if (v instanceof Date) return v.getTime();
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function esUrgente_(o) {
  return o.pedido_detenido === 'SI' ? 1 : 0;
}

function esVerdadero_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v).trim().toUpperCase() === 'SI';
}

function esCorreo_(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

/* ------------------------------------------------------------------ */
/* Pruebas manuales (ejecutar desde el editor)                         */
/* ------------------------------------------------------------------ */

/** Ejecuta esto primero: verifica la conexión con Odoo y con la hoja. */
function probarConexion() {
  Logger.log('UID de Odoo: ' + odooUid_());
  Logger.log('Operarios: ' + JSON.stringify(init_().operarios));
  Logger.log('Correo de compras: ' + config_().correo_compras);
}

/** Cambia la referencia por una real de Odoo para probar la búsqueda. */
function probarBusqueda() {
  Logger.log(JSON.stringify(buscarProducto_({ ref: 'CAMBIA-ESTA-REF' }), null, 2));
}
