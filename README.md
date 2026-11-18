# Pendientes y Compras

Plataforma para que los operarios reporten productos agotados o con pocas unidades durante el alistamiento (desde un QR), y para que el administrador agrupe esas solicitudes y las envíe a Compras por Gmail, con respaldo de cada envío.

- **Frontend:** GitHub Pages (HTML, CSS y JS sin dependencias de compilación).
- **Backend:** Google Apps Script publicado como aplicación web.
- **Base de datos:** Google Sheets `Gestion_Compras` (hojas Solicitudes, Cortes, Historial, Operarios, Config).
- **Productos e inventario:** Odoo Online por JSON-RPC con API key.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `index.html` | Formulario del operario (PWA instalable). Es la página a la que apunta el QR. |
| `admin.html` | Dashboard del administrador: bandeja, cortes por Gmail e histórico de cortes. |
| `cartel-qr.html` | Cartel para imprimir con el QR del formulario. |
| `js/config.js` | **Aquí se pega la URL del Web App.** |
| `js/api.js`, `js/form.js`, `js/admin.js` | Lógica del frontend. |
| `js/vendor/qrcode.js` | Generador de QR (qrcode-generator 1.4.4, licencia MIT, Kazuhiko Arase). |
| `css/styles.css` | Estilos compartidos. |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que hace instalable la app en el celular. |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | Backend para pegar en Apps Script. |

## Puesta en marcha

### 1. Apps Script

1. Abre la hoja **Gestion_Compras** → *Extensiones* → *Apps Script*.
2. Borra el contenido de `Código.gs` y pega el de `apps-script/Code.gs`.
3. En *Configuración del proyecto* (engranaje):
   - Marca **Mostrar el archivo de manifiesto "appsscript.json"** y reemplaza su contenido por el de `apps-script/appsscript.json`.
   - En **Propiedades del script** agrega:

     | Propiedad | Valor |
     | --- | --- |
     | `ODOO_URL` | `https://tuempresa.odoo.com` (sin `/` al final) |
     | `ODOO_DB` | nombre de la base de datos |
     | `ODOO_USER` | correo del usuario dueño de la API key |
     | `ODOO_API_KEY` | la API key |

4. En el editor, elige la función `probarConexion` y dale **Ejecutar**. Autoriza los permisos. En el registro debe salir el UID de Odoo, los 7 operarios y el correo de compras.
5. Cambia `CAMBIA-ESTA-REF` en `probarBusqueda` por una referencia real y ejecútala para ver lo que trae Odoo.
6. **Implementar** → *Nueva implementación* → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
7. Copia la URL que termina en `/exec`.

> Cada vez que cambies `Code.gs`: *Implementar* → *Administrar implementaciones* → editar → *Nueva versión*. Así la URL no cambia.

### 2. Frontend en GitHub Pages

1. Pega la URL del paso anterior en `js/config.js` (`API_URL`).
2. Sube la carpeta a un repositorio de GitHub.
3. En el repositorio: *Settings* → *Pages* → *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
4. En uno o dos minutos queda en `https://<usuario>.github.io/<repositorio>/`.
   - Formulario: `.../index.html` (o la raíz)
   - Administrador: `.../admin.html` (no lo enlaces desde ningún lado; es la única "protección" mientras no haya contraseña)
   - Cartel: `.../cartel-qr.html`

### 3. Cartel y celulares

1. Abre `cartel-qr.html` desde GitHub Pages: el QR se genera solo con la dirección del formulario.
2. *Imprimir cartel* → papel carta, a color si se puede. Imprime varias copias y pégalas en distintos puntos de la bodega.
3. En el celular, escanea el QR y toca **Instalar** (Android/Chrome). En iPhone: *Compartir* → *Agregar a inicio*.

## Cómo funciona

**Operario:** elige su nombre, escribe la referencia interna, ve el producto con el inventario de Odoo, marca qué pasa (agotado, pocas unidades, dañado, la referencia no coincide u otro), y opcionalmente cuántas quedan, el pedido que alistaba y si el pedido quedó detenido (urgente).

**Duplicados:** si la misma referencia ya tiene una solicitud en estado *Nueva* reportada en las últimas 24 h (`Config!horas_antiduplicado`), el reporte se suma a esa solicitud (columna `reportes`) en vez de crear otra fila.

**Administrador:** selecciona solicitudes nuevas, escribe la cantidad mínima y una nota para cada una, y da **Crear correo a compras**. Entonces:

1. Se crea el corte (`CORTE-0001`) en la hoja Cortes con el resumen exacto.
2. Las solicitudes pasan a *Enviada a compras*.
3. Se abre Gmail con el destinatario, el asunto y el resumen en texto plano (urgentes primero).
4. El dashboard pregunta si se envió: **Sí** lo marca como *Enviado (confirmado)*; **No** lo anula y las solicitudes vuelven a *Nueva*.

La pestaña **Cortes enviados** es el respaldo: qué se pidió, a quién y cuándo, y si se confirmó el envío.

El correo de compras por defecto está en `Config!correo_compras`; se puede cambiar desde el dashboard con **Guardar correo**.

## Límites conocidos

- El enlace de Gmail solo admite texto plano y tiene un largo máximo: un corte de unos 40 productos o más se rechaza y hay que dividirlo en dos.
- Abrir Gmail no garantiza que el correo salió; por eso existe la confirmación.
- Sin contraseña: cualquiera con la URL de `admin.html` puede gestionar solicitudes. Todo queda registrado en Historial.
- Sin señal, la app abre pero no puede enviar; el operario ve el mensaje "Sin conexión a internet".

## Para más adelante

- Crear la solicitud de presupuesto (RFQ) en Odoo desde el corte.
- Avisar al operario cuando el producto llegó (estado *Comprada*).
- Indicadores para Looker Studio.
- Búsqueda por código de barras EAN-13 con lector físico.
