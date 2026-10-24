# Deploy de bitly-site en Cloudflare Pages

El sitio es una app de **TanStack Start**: la landing es estática
(prerenderizada), pero la **demo necesita servidor**. Buscar, resolver el audio
y canjear un código Premium pasan por server functions cifradas
(`src/server/demo-proxy.ts`, `src/lib/premium-check.ts`); nada de eso puede
correr en el navegador.

Por eso el proyecto se publica en **modo avanzado**: `pnpm build` deja, además
del estático, un `_worker.js` que atiende las server functions.

## 1. Repositorio y rama

- Repo: `github.com/QuopTron/bitly-site`
- **Rama de producción: `master`** (no `main`: no existe en este repo).
- El proyecto de Pages está conectado al repo: cada push a `master` dispara un
  build y un deploy.

## 2. Configuración del proyecto en Pages

- **Build command:** `npm run build` (Cloudflare detecta pnpm por el lockfile y
  corre `pnpm install` solo; el comando de build como tal es `npm run build`).
- **Build output directory:** `dist/client`
- **Rama de producción:** `master`

Compatibility flags: **`nodejs_compat`** (necesario para que exista `process`) y
una `compatibility_date` **reciente** (hoy `2026-05-16`). Las dos cosas se
configuran en el dashboard (Settings → Functions / Runtime).

> **NO agregar un `wrangler.toml` al repo.** Se probaron dos variantes y las dos
> rompen algo:
>
> 1. Con claves no soportadas (`account_id`, `[build]`) el builder de Pages
>    **aborta el build** — fue lo que dejó el sitio congelado en un deploy viejo.
> 2. Con un archivo *válido* (o sea, con `pages_build_output_dir`), Pages lo toma
>    como **fuente de verdad** y **descarta la configuración del dashboard**: el
>    deploy de `67bc602` quedó con `env_vars` vacío, borrando las `SUPABASE_*` y
>    `BITLY_CODES_TOKEN`.
>
> Lo correcto es que **toda la configuración viva en el dashboard** (build
> command, output dir, env vars, compatibility flags). El repo solo aporta el
> `_worker.js` que genera el build. Para comandos locales que necesiten la
> cuenta, usá la variable `CLOUDFLARE_ACCOUNT_ID`.

## 3. Cómo queda el modo avanzado

`pnpm build` (`vite build && node scripts/cloudflare-worker.mjs`) corre
`scripts/cloudflare-worker.mjs`, que:

1. copia `dist/server` a `dist/client/_ssr/`;
2. escribe `dist/client/_worker.js`, el entry de Pages.

Ese `_worker.js` es **conservador a propósito**:

| Petición | Quién la atiende |
| --- | --- |
| `GET` (HTML, `/assets/*`, `.well-known`) | el CDN de Pages, igual que antes |
| `POST /_serverFn/*` (la demo) | la app |
| el resto | la app y, si no contesta, el CDN |

`_worker.js` **no se publica como estático**, pero ojo: Pages **sí** sirve la
carpeta `_ssr/` con su Content-Type real (se comprobó en producción). Por eso el
entry corta `/_ssr/*` con un 404 antes de consultar al CDN: el bundle se importa
desde el worker, nadie necesita bajarlo por HTTP.

### El `_worker.js` siembra `process.env`

El bundle del servidor trae su propio polyfill de `process` (unenv) con el
`env` **vacío**: `process.env.X` es `undefined` aunque la variable esté
perfectamente configurada en Pages. Por eso el entry, antes de delegar, copia
las bindings de `env` a `process.env`:

```js
function sembrarEnv(env) {
  if (typeof process === "undefined" || !process.env) return;
  for (const [clave, valor] of Object.entries(env)) {
    if (typeof valor === "string" && process.env[clave] === undefined) {
      process.env[clave] = valor;
    }
  }
}
```

Sin esto las `BITLY_DATA_TOKEN` y el `BITLY_CODES_TOKEN` no llegan al SSR: la
búsqueda funciona (no las usa) pero el canje de códigos responde "no pudimos
verificar" y el sitio no puede leer ni escribir `bitly-data`. Nota: `process`
**sólo existe** con `nodejs_compat`, y `process.env` sólo se puebla desde `env`
con una `compatibility_date` reciente — con `2024-09-23` venía vacío.

Verificado en local con el runtime real:

```bash
pnpm build
npx wrangler pages dev dist/client --port 8799 \
  --compatibility-date=2026-05-16 --compatibility-flags=nodejs_compat

# en otra terminal
DEMO_URL=http://127.0.0.1:8799 node scripts/verificar-demo.mjs   # 13/13
```

> Ojo con el gestor: usá el `pnpm` instalado (hoy 10.x). `npx pnpm` puede bajar
> una major nueva y romper por el campo `pnpm` de `package.json`.

## 4. Variables de entorno

| Variable | Para qué |
| --- | --- |
| `BITLY_CODES_TOKEN` | **Obligatoria** para el canje de códigos Premium: token de GitHub con lectura al repo privado `QuopTron/bitly_codes_premium`. Sin ella el canje responde "no pudimos verificar". |
| `BITLY_DATA_TOKEN` | **Obligatoria** para la base de datos del sitio: token de GitHub con `contents: write` sobre `QuopTron/bitly-data` (opiniones, vistas y contadores de descargas). Si falta, se usa `BITLY_CODES_TOKEN` como respaldo. |
| `BITLY_DATA_REPO`, `BITLY_CHATS_REPO` | Opcionales: cambian el repo de datos o el de chats (`QuopTron/bitly-data` y `QuopTron/bitly-chats` por defecto). |
| `BITLY_ADMIN_CODE` | **Obligatoria**: código del panel admin (tres clics en el logo). No hay valor por defecto: sin ella el panel queda cerrado y el Worker registra «falta BITLY_ADMIN_CODE». Usá 16+ caracteres aleatorios. |
| `BITLY_DATA_SECRET` | **Recomendada**: cifra con AES-256-GCM todo lo que se guarda en el repo de datos (pedidos, cuentas, comprobantes, chats, contadores). Sin ella los archivos quedan en claro en cada commit. Tiene que ser **la misma** en local y en Cloudflare: si cambia, lo viejo deja de leerse. |
| `BITLY_SESSION_SECRET` | **Cargada en producción**: secreto para firmar las sesiones de las cuentas del sitio. Si falta (por ejemplo en local), se deriva de `BITLY_DATA_TOKEN`/`BITLY_CODES_TOKEN` y el Worker lo avisa en el log. Cambiarlo cierra todas las sesiones. |
| `BITLY_SMTP_HOST`, `BITLY_SMTP_PORT`, `BITLY_SMTP_USER`, `BITLY_SMTP_PASS` | SMTP para los correos de pedidos. En Gmail: `smtp.gmail.com`, puerto `465` y una **contraseña de aplicación**. |
| `BITLY_EMAIL_FROM`, `BITLY_ADMIN_EMAIL` | Remitente y destinatario de avisos (`floxdev2024@gmail.com`). |
| `RESEND_API_KEY` | Alternativa a SMTP: API key de Resend. |
| `BITLY_EMAIL_WEBHOOK` | Opcional: URL que recibe los correos por HTTP. |
| `YATTEE_URL`, `YATTEE_AUTH` | Canal de YouTube de la demo (**producción**): yattee-server con yt-dlp y auth básica "usuario:contraseña". Sin ellas la demo funciona, pero el folklore de nicho queda sin audio. Ver 5.2. |
| `YT_DLP_BACKEND_URL`, `YT_DLP_TOKEN` | Sólo desarrollo: backend local `pnpm yt-dlp`. No hay imagen publicada y no se cargan en Pages. |

Se cargan en **Pages → Settings → Environment variables**. No hay que prefijar
`BITLY_CODES_TOKEN` con `VITE_` (eso la mandaría al navegador).

### Correo de pedidos (SMTP Gmail)

En Cloudflare el envío usa `worker-mailer` con `cloudflare:sockets` (el build ya
lo soporta y lo deja en `_ssr/`). En localhost (`pnpm dev`) ese módulo no existe,
así que `correo.ts` cae a un cliente SMTP propio sobre `node:tls` (puerto 465):
las mismas variables en `.env` alcanzan para probar una compra completa sin
desplegar. `pnpm probar:correo <correo>` manda la plantilla real y deja una
vista previa en `scripts/.cache/correo.html`.

Para Gmail hay que generar una **contraseña de aplicación** (no la contraseña
normal) y cargar los secretos:

```bash
npx wrangler pages secret put BITLY_SMTP_HOST --project-name bitly-site
npx wrangler pages secret put BITLY_SMTP_PORT --project-name bitly-site
npx wrangler pages secret put BITLY_SMTP_USER --project-name bitly-site
npx wrangler pages secret put BITLY_SMTP_PASS --project-name bitly-site
npx wrangler pages secret put BITLY_EMAIL_FROM --project-name bitly-site
npx wrangler pages secret put BITLY_ADMIN_EMAIL --project-name bitly-site
npx wrangler pages secret put BITLY_ADMIN_CODE --project-name bitly-site
```

Después de cargarlos hay que **redesplegar** (push a `master`) para que el
worker nuevo los reciba. En el panel admin, pestaña **Pedidos**, el botón
**Probar correo** envía un mensaje a `BITLY_ADMIN_EMAIL`. Si no hay ningún
método configurado, el panel avisa "Correo sin configurar" y los pedidos se
guardan igual.

### Comprobantes y QR

- Los comprobantes se guardan en el repo privado `QuopTron/bitly-data`, carpeta
  `data/comprobantes/`; los pedidos en `data/pedidos.json`.
- Las cuentas del sitio viven en `data/cuentas.json` (contraseñas con PBKDF2,
  nunca en claro) y las sesiones se firman con `BITLY_SESSION_SECRET`. El botón
  **Sincronizar códigos** del panel admin espeja en `data/codigos.json` los
  conteos del registro de `bitly_codes_premium` (activos/usados/cancelados),
  nunca la lista de códigos: duplicar códigos válidos en otro repo sólo agranda
  el daño de una filtración.
- El QR de pago se sirve desde `public/qr.png` (o `.jpg`/`.jpeg`/`.webp`). Si no
  existe, el modal muestra un aviso y el enlace de WhatsApp en su lugar.

Para probar el canje en local alcanza con tenerla en `.env` y correr el server
de desarrollo (`pnpm dev`): ahí las server functions corren en Node y leen
`process.env` directo. Con `wrangler pages dev` el `.dev.vars` de la raíz no
llega al `env` del runtime — es una limitación de ese comando, no del deploy.

## 5. Seguridad: qué ya está y qué conviene sumar

Lo que el sitio hace solo:

- **Nada de secretos en el cliente.** Los tokens de GitHub viven en el Worker;
  el build de producción va sin source maps y `/_ssr/`, `/_build/`, los `.map`
  y los archivos ocultos responden 404 desde el propio worker.
- **Datos cifrados en reposo** con `BITLY_DATA_SECRET` (AES-256-GCM): pedidos,
  cuentas, comprobantes, contadores.
- **Panel privado cerrado por defecto**: `BITLY_ADMIN_CODE` es obligatoria y la
  comparación es en tiempo constante, con 10 fallos por IP cada 10 minutos.
  No hay código por defecto escrito en el repo.
- **Contraseñas** con PBKDF2-SHA256 (100.000 iteraciones, el tope del runtime) y
  sal por cuenta; el login tarda lo mismo exista o no el correo.
- **Cupos por IP y globales** en pedidos, opiniones, chats, cuentas, canje de
  códigos, búsqueda y audio de la demo, letras y analítica; cuerpo máximo de
  6 MB en las server functions (413 por encima).
- **CSP con hashes** de los guiones inline (sin `unsafe-inline` en `script-src`),
  más HSTS, `X-Frame-Options: DENY`, `nosniff` y `frame-ancestors 'none'`.

Lo que conviene sumar desde el panel de Cloudflare (no se puede hacer desde el
código):

1. **Rate limiting en el borde** para `/_serverFn/*` y `POST` en general
   (Security → WAF → Rate limiting rules). Los cupos del Worker viven en la
   memoria de cada isolate: frenan una ráfaga, pero una botnet repartida sólo se
   corta en el edge.
2. **Token propio para los datos**: hoy `BITLY_DATA_TOKEN` no está definido y se
   usa `BITLY_CODES_TOKEN`, así que un solo PAT abre los dos repos. Creá un
   token *fine-grained* con `contents: write` sólo sobre `bitly-data` y
   `bitly-chats`, cargalo como `BITLY_DATA_TOKEN` y dejá el de códigos con
   lectura de `bitly_codes_premium`.
3. **`BITLY_SESSION_SECRET` propio**: ya está cargado en producción (64 hex
   aleatorios), así que las sesiones no dependen del token de GitHub. Si algún
   día se rota, todas las sesiones abiertas se cierran: es el precio de que el
   token y la firma sean claves distintas. En local, si falta, se sigue
   derivando del token y el Worker lo avisa en el log.
4. **Retención de comprobantes**: los archivos de `data/comprobantes/` no se
   borran solos. Desde la pestaña **Pedidos** del panel privado, **Eliminar
   pedido** borra la fila y su comprobante del repo (con confirmación; no se
   puede deshacer). Conviene purgar los pedidos cerrados de vez en cuando: el
   repo es privado y está cifrado, pero un comprobante no necesita vivir para
   siempre.

## 5.1 Plan free: cómo entra el sitio

El sitio está pensado para el plan gratuito de Pages/Workers (100.000
peticiones por día, 10 ms de CPU por petición). Lo que lo hace entrar cómodo:

- **La portada no gasta Functions.** El HTML se prerenderiza en el build y lo
  sirve el CDN. Al worker sólo llegan las `POST /_serverFn/*` (la demo, los
  pedidos, las cuentas) y alguna ruta que el CDN no tenga.
- **La CSP se calcula una vez por versión del HTML.** Se cachea por `ETag`: el
  primer visitante paga el hash de los guiones inline y el resto lo recibe de
  memoria. Sin esto, cada visita re-parseaba cientos de KB para llegar al mismo
  resultado, justo en el límite de CPU del plan free.
- **Sin servicios que se cobren aparte.** No hay KV, D1, R2, Durable Objects ni
  cron: el estado vive en el repo privado y en la memoria del isolate.
- **La caché y los cupos son por isolate.** En free, cada isolate nuevo arranca
  frío: la primera visita puede tardar un poco más y los cupos se reinician.
  Para el abuso repartido sigue haciendo falta una regla de WAF (sección 5).
- **Nada depende de un backend que duerme.** Si el host del backend de yt-dlp
  está en un plan free que se apaga por inactividad, la demo sigue andando con
  los catálogos; el canal de YouTube sólo hace falta para folklore de nicho y
  re-subidos.

## 5.2 Canal de YouTube (Yattee)

El folklore de nicho y lo re-subido no está en los catálogos: para eso la demo
pide audio a **yattee-server**, un servidor propio con yt-dlp que corre en Render
free (`YATTEE_URL` + `YATTEE_AUTH` con formato "usuario:contraseña" para su auth
básica). Es el canal de producción; sin esas dos variables la demo sigue andando
con los catálogos y esas pistas quedan sin audio.

Medido contra el servicio real (octubre 2026):

| Paso | Tiempo |
| --- | --- |
| `/health` (despierto) | 0,8 s |
| `/api/v1/search` | 3 s |
| `/api/v1/videos/:id` con el extractor en frío | ~25 s |
| el mismo video con la caché del extractor | ~2 s |
| el relay (`/proxy/relay` con `Range`) | 206, 0,6 s |

Con eso, el primer tema de nicho tarda ~25 s en sonar, y la demo **precalienta
el audio del primer resultado** mientras el visitante mira la lista: ese trabajo
se paga antes del clic. Un enlace del relay vence a las 6 h, así que no se guarda
más de una hora.

Lo que hace el sitio para que un host free no se note:

- **Despertador al abrir la demo.** El reproductor llama a `demoDespertar` al
  montar y el servidor le pega `GET /` a Yattee con hasta 40 s de paciencia:
  cualquier respuesta HTTP (200, 401, 404) significa que el proceso está arriba.
  El arranque se paga mientras el visitante escribe, no cuando toca *play*.
  Queda marcado como despierto 10 minutos por isolate.
- **Cupo del despertador**: 5 pings por IP cada 10 minutos. El endpoint es
  barato, pero un ping sin freno es una forma de martillar el host.
- **Búsqueda tolerante**: antes del search se le dan hasta 6 s al arranque; si no
  contesta, la demo sigue con los catálogos y no se bloquea.
- **Audio con más margen**: el pedido de audio espera el arranque completo (40 s)
  y después tiene sus 30 s de resolución.

Para comprobarlo de punta a punta:

```bash
YATTEE_URL=https://yattee-server-2j61.onrender.com \
YATTEE_AUTH='admin:<la-contraseña>' \
  node scripts/verificar-yattee.mjs "Los Thuthanaka"
```

Son 10 comprobaciones: salud, ajustes del servidor (PO token, proxy de salida,
timeout de yt-dlp), búsqueda, formatos de audio del extractor y bytes reales del
relay con `Range`. `ACTIVAR_POT=1` enciende el proveedor de PO token en caliente
si algún día YouTube aprieta (hoy está apagado y el extractor funciona igual).

### Backend propio, sólo para desarrollo

`scripts/backend-yt-dlp.mjs` (`pnpm yt-dlp`) sigue disponible para probar el
canal de YouTube sin depender de Yattee: levanta un proceso con `yt-dlp` en
`http://127.0.0.1:8787` y el sitio lo usa si `YT_DLP_BACKEND_URL` apunta ahí (y
`YT_DLP_TOKEN` coincide). **No hay imagen publicada**: se quitaron
`Dockerfile.backend` y el blueprint de Render porque el canal de producción es
Yattee y no hace falta un segundo servicio.

## 6. Comprobar que quedó bien

```bash
# 1. La landing responde
curl -s -o /dev/null -w "%{http_code}\n" https://bitly-site.pages.dev/

# 2. Las server functions existen (403 = existe y pide Origin; 405 = NO está)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://bitly-site.pages.dev/_serverFn/abc" -H "x-tsr-serverfn: true"

# 3. La demo entera, en un Chrome de verdad
DEMO_URL=https://bitly-site.pages.dev node scripts/verificar-demo.mjs

# 4. El canje Premium contra el registro real. Necesita un código con estado
#    "usado" y, para probar el camino feliz, uno con estado "activo" (sólo
#    lectura: el sitio nunca marca códigos, así que el activo sigue activo).
#    Se sacan de scripts/.cache/codes.json, que está en .gitignore, y se pasan
#    por entorno: nunca se imprimen ni se guardan en el repo.
DEMO_URL=https://bitly-site.pages.dev CODIGO_USADO=<código> \
  CODIGO_ACTIVO=<código> node scripts/probar-premium.mjs
```

El punto 4 son 9 aserciones: las server functions responden 200 (no 500), el
estado que devuelve el servidor es el real del registro, un código usado **no**
deja Premium guardado y un código activo sí lo activa (después se limpia del
perfil de prueba).

Si el punto 2 devuelve **405**, el build volvió a publicar sólo estáticos: falta
el `_worker.js` (¿se rompió el `build`?).

Si el punto 4 dice "El registro no respondió", el problema es de entorno, no del
registro: revisá que `BITLY_CODES_TOKEN` esté en las env vars, que
`nodejs_compat` esté activo y que la `compatibility_date` sea reciente (ver la
sección 3 sobre la siembra).
