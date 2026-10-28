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

### La app real en `/app` (la PWA de Bitly)

El sitio sirve **la app** —el bundle de Flutter— en `/app/`, para que instalarla
desde acá instale Bitly y no la web del proyecto. La arma
`node scripts/copiar-app-web.mjs`, que corre primero en `pnpm build` (antes del
build de Vite, porque lo que copia es estático de `public/`).

**De dónde saca el bundle**, en orden: `BITLY_APP_WEB` (ruta) → el `build/web`
local del repo de la app → **la rama `gh-pages` de `QuopTron/bitly-releases`**
(el `.tar.gz` público que publica el workflow `Deploy PWA`). El tercero es el
único que existe en el builder de Cloudflare Pages, donde **no hay repo de la
app**: sin él el deploy salía sin `/app`, `/app/` respondía **404** y el enlace
«Abrir la app (PWA)» de la sección de instalación llevaba a la página de «no
encontrada» — es decir, quien entraba desde un iPhone o una Mac terminaba
instalando el sitio.

**Orden de publicación al sacar una versión**: primero el `Deploy PWA` (deja el
bundle en `gh-pages`), después el push a `master` del sitio. Si se hace al revés,
el deploy del sitio copia la PWA anterior.

La copia reescribe `<base href="/app/">` y fija el manifiesto en
`id: bitly-app`, `start_url`/`scope` relativos. Es **otra PWA** que la del sitio
(esta web): dos identidades distintas, así que las dos conviven.

`public/app/` **no se versiona** (está en `.gitignore`): son decenas de MB de
bundle que se regeneran en cada build. Y si los tres orígenes fallan, el script
avisa y **el sitio se compila igual** sin `/app` (publicar el sitio no puede
depender de que GitHub esté disponible).

## 4. Variables de entorno

| Variable | Para qué |
| --- | --- |
| `BITLY_CODES_TOKEN` | **Obligatoria** para el canje de códigos Premium: token de GitHub con lectura al repo privado `QuopTron/bitly_codes_premium`. Sin ella el canje responde "no pudimos verificar". |
| `BITLY_DATA_TOKEN` | **Obligatoria** para la base de datos del sitio: token de GitHub con `contents: write` sobre `QuopTron/bitly-data` (opiniones, vistas y contadores de descargas). Si falta, se usa `BITLY_CODES_TOKEN` como respaldo. |
| `BITLY_DATA_REPO`, `BITLY_CHATS_REPO` | Opcionales: cambian el repo de datos o el de chats (`QuopTron/bitly-data` y `QuopTron/bitly-chats` por defecto). |
| `BITLY_ADMIN_CLAVE` | **Obligatoria**: clave del panel del dueño (`/admin`). El panel pide correo + clave y devuelve un token firmado que vence a los 7 días. Sin ella el panel queda cerrado y el Worker registra «falta BITLY_ADMIN_CLAVE». Usá 16+ caracteres aleatorios. |
| `BITLY_ADMIN_EMAIL`, `BITLY_ADMIN_SECRET` | Correo del dueño (por defecto `floxdev2024@gmail.com`) y, opcional, secreto propio para firmar el token del panel. Si falta el secreto se deriva de `BITLY_SESSION_SECRET`/el token de GitHub. |
| `BITLY_DATA_SECRET` | **Recomendada**: cifra con AES-256-GCM todo lo que se guarda en el repo de datos (pedidos, cuentas, comprobantes, chats, contadores). Sin ella los archivos quedan en claro en cada commit. Tiene que ser **la misma** en local y en Cloudflare: si cambia, lo viejo deja de leerse. |
| `BITLY_CODIGOS_CLAVE` | Clave privada Ed25519 con la que el sitio firma los códigos Premium que emite al validar un pedido. Acepta el **PEM tal como está `scripts/keys/private_key.pem`** (el sobre con la semilla cruda de 32 bytes), la semilla sola en base64/base64url, o un PKCS#8 real. **Tiene que ser el par de la clave pública que verifica la app**: con una clave nueva los códigos se firman bien pero la app los rechaza hasta que actualice su pública. Sin ella, el panel cae al registro `bitly_codes_premium`. Verificación de que el par coincide: `cargo test`/`go test ./internal/premium -run TestLaClaveDelSitio` (firma un código con esta clave y lo valida con la pública de la app) y `node scripts/probar-codigos-sitio.mjs`. |
| `BITLY_VENTANA_PEDIDO_MIN` | Opcional: minutos para anular una compra recién hecha (por defecto 10 en producción y 1 en local). |
| `BITLY_SESSION_SECRET` | **Obligatoria en producción**: es el único secreto con el que se FIRMAN las sesiones de las cuentas. Si falta, el sitio **no emite sesiones nuevas** (responde `sin_secreto`, que la app traduce con un mensaje claro) y sólo puede VERIFICAR las que se firmaron antes con un token de GitHub prestado — así una rotación de PAT no vuelve a matar todas las sesiones de golpe. Al definirlo o cambiarlo, los tokens anteriores dejan de valer y cada usuario entra de nuevo una vez (es el comportamiento buscado al rotar). Ver `node scripts/probar-sesion-cuenta.mjs`. |
| `BITLY_SMTP_HOST`, `BITLY_SMTP_PORT`, `BITLY_SMTP_USER`, `BITLY_SMTP_PASS` | SMTP para los correos de pedidos. En Gmail: `smtp.gmail.com`, puerto `465` y una **contraseña de aplicación**. |
| `BITLY_EMAIL_FROM`, `BITLY_ADMIN_EMAIL` | Remitente y destinatario de avisos (`floxdev2024@gmail.com`). |
| `RESEND_API_KEY` | Alternativa a SMTP: API key de Resend. |
| `BITLY_EMAIL_WEBHOOK` | Opcional: URL que recibe los correos por HTTP. |
| `YATTEE_URL`, `YATTEE_AUTH` | Canal de YouTube de la demo (**producción**): yattee-server con yt-dlp y auth básica "usuario:contraseña". Sin ellas la demo funciona, pero el folklore de nicho queda sin audio. Ver 5.2. |
| `YATTEE_URL_2`, `YATTEE_CONCURRENCIA` | Opcionales: segunda instancia Render para failover y cupo de extracciones simultáneas (por defecto 2). Ver 5.2. |
| `YT_DLP_BACKEND_URL`, `YT_DLP_TOKEN` | Sólo desarrollo: backend local `pnpm yt-dlp`. No hay imagen publicada y no se cargan en Pages. |

Se cargan en **Pages → Settings → Environment variables**. No hay que prefijar
`BITLY_CODES_TOKEN` con `VITE_` (eso la mandaría al navegador).

**Cuentas del sitio**: con el correo configurado, el alta pide un código de 6
dígitos y las invitaciones mandan usuario + contraseña por defecto a la persona.
Sin correo configurado (por ejemplo en local) el alta se confirma sola, para no
trabar las pruebas: en producción conviene tener SMTP o Resend cargado.

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
npx wrangler pages secret put BITLY_ADMIN_CLAVE --project-name bitly-site
npx wrangler pages secret put BITLY_ADMIN_SECRET --project-name bitly-site
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
  **Sincronizar códigos** de la pestaña Pedidos espeja en `data/codigos.json` los
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
- **Panel del dueño cerrado por defecto**: vive en `/admin`, pide correo y clave
  (`BITLY_ADMIN_CLAVE`) y entrega un token firmado con vencimiento en lugar de
  la clave. La comparación es en tiempo constante, con 5 fallos por IP cada 10
  minutos. No hay clave por defecto escrita en el repo y ya no existe el acceso
  por tres clics en el logo. Cambiar la clave invalida los tokens emitidos.
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
   borran solos. Desde `/admin` → **Pedidos**, **Eliminar
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

### Mantenimiento: cuando el audio de nicho deja de resolver

El extractor de YouTube se rompe cada tanto (YouTube cambia el reto JS o el
cliente `web_embedded`). El síntoma es siempre el mismo: la búsqueda encuentra
el tema, pero `/api/v1/videos/:id` contesta **200 con `adaptiveFormats` vacío** y
a los ~25 s la pista queda sin audio. `node scripts/verificar-yattee.mjs "<tema>"`
lo dice en una corrida (comprueba "formatos de audio de <id>").

Ese servicio construye su imagen con `requirements.txt`, que pide
`yt-dlp>=2026.08.19`, pero **Docker cachea la capa de `pip install`**: un
redeploy normal reusa la capa y sigue con el yt-dlp viejo. Cuando pase, en el
dashboard de Render del servicio:

1. **Manual Deploy → Clear build cache & deploy** (no alcanza con el redeploy
   común ni con el `autoDeploy` del push).
2. Esperar el build (~3-5 min) y volver a correr el verificador.
3. Si aun así falla, el bloqueo es de IP o de PO token: probar
   `ACTIVAR_POT=1` (enciende el proveedor sin reiniciar) y, si mejora,
   `YT_POT_ENABLED=true` en el entorno del servicio para que sobreviva a los
   reinicios.

El sitio no necesita ningún cambio en esos casos: apunta a la misma URL y el
mismo token.

### Dos servicios Render y "memoria llena" (OOM)

Si tenés **dos servicios** apuntando al mismo repo de Yattee, usalos como
principal y respaldo: `YATTEE_URL` y `YATTEE_URL_2`. El sitio prueba el primero
y, si falla por red/5xx, pasa al segundo; una base caída queda en cuarentena 60 s
para no pagar el timeout en cada canción. No hace falta balanceador.

Para el OOM del plan free (512 MB), de más a menos efectivo:

1. **Un solo servicio activo para audio.** El segundo debe quedar como respaldo
   (sleep/scale a cero si se puede). Dos extractores yt-dlp/FastAPI compitiendo
   por 512 MB es la causa más común.
2. **Limitar la concurrencia.** El sitio ya encola las extracciones con
   `YATTEE_CONCURRENCIA=2` (por defecto). En el Render del backend, si su
   servidor lo permite, dejá también 1-2 workers; cada `/videos/:id` lanza un
   proceso de yt-dlp + ffmpeg.
3. **Reiniciar de verdad:** Manual Deploy → **Clear build cache & deploy**. Un
   redeploy normal reusa la imagen y no libera nada.
4. **Subir a Starter (2 GB)** si aun con concurrencia 1 el pico de memoria sigue
   matando el proceso. El plan free no tiene swap.
5. `MALLOC_ARENA_MAX=2` en el entorno del servicio reduce la fragmentación de
   glibc; es barato y no cambia el comportamiento.

El síntoma de OOM en Render suele ser el servicio reiniciándose solo y
`/health` contestando 502/503 durante unos segundos; el failover a
`YATTEE_URL_2` cubre ese hueco.

### Backend propio, sólo para desarrollo

`scripts/backend-yt-dlp.mjs` (`pnpm yt-dlp`) sigue disponible para probar el
canal de YouTube sin depender de Yattee: levanta un proceso con `yt-dlp` en
`http://127.0.0.1:8787` y el sitio lo usa si `YT_DLP_BACKEND_URL` apunta ahí (y
`YT_DLP_TOKEN` coincide). **No hay imagen publicada**: se quitaron
`Dockerfile.backend` y el blueprint de Render porque el canal de producción es
Yattee y no hace falta un segundo servicio.

## 5.3 La app real en `/app` (PWA) y la PWA del sitio

Son dos PWA distintas, a propósito:

| Ruta | Qué instala | Manifiesto |
|---|---|---|
| `/` | **el sitio** (el catálogo, la demo, las guías) | `site.webmanifest` — «Bitly Sitio», `id: /sitio` |
| `/app/` | **Bitly, la app** (el bundle de Flutter) | `app/manifest.json` — «Bitly», `id: bitly-app` |

Antes, quien instalaba desde el sitio instalaba el sitio: el bundle de la app
sólo vivía en GitHub Pages (`QuopTron/bitly-releases`). Ahora también sale de
acá (`https://bitly-site.pages.dev/app/`), que es lo que pidió el dueño.

El bundle **no se versiona**: `pnpm preparar:app` (lo llama `pnpm build`) copia
`../bitly/build/web` a `public/app/` y reescribe `<base href="/app/">`. Si el
build de la app no está en la máquina, el sitio compila igual sin `/app` (avisa
y sigue), así un deploy del sitio solo no se traba.

Dos cosas se rompen si no se respetan, y las dos están puestas:

1. **CSP propia de `/app`** (`scripts/cloudflare-worker.mjs`): el bundle compila
   WebAssembly (`'wasm-unsafe-eval'`) y habla con el servidor Go que configura el
   usuario, en cualquier host (`connect-src *`). Con la CSP del sitio la app no
   arranca; la de `/` queda igual de estricta que siempre.
2. **`prerender.filter` en `vite.config.ts`**: el crawler seguía el enlace
   «Abrir la app (PWA)» de la sección de instalación y hacía fallar el build
   entero, porque `/app` no es una ruta del sitio.

Para publicar una versión nueva de la app: `flutter build web --base-href=/app/`
en el repo `bitly`, después `pnpm preparar:app` y el build del sitio.

### Cuota de las 75: volver a 75 para todos

```bash
pnpm reiniciar:cuota --ver   # cómo está hoy (no escribe)
pnpm reiniciar:cuota         # las deja a TODAS con las 75
```

Corre el mismo motor que el Worker (`reiniciarCuotaGlobal`) con el `.env` real,
así que escribe `data/descargas.json` en `bitly-data` con el cifrado y la cola
de siempre. **Conserva los eventos** del historial: sólo pone el contador en
cero. Necesita `BITLY_DATA_TOKEN` (o `BITLY_CODES_TOKEN`) en `.env`.

## 6. Comprobar que quedó bien

```bash
# 1. La landing responde
curl -s -o /dev/null -w "%{http_code}\n" https://bitly-site.pages.dev/

# 2. Las server functions existen (403 = existe y pide Origin; 405 = NO está)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://bitly-site.pages.dev/_serverFn/abc" -H "x-tsr-serverfn: true"

# 2b. El contrato de la APP (405/404 = el sitio viejo, la app no puede entrar)
curl -s -X POST https://bitly-site.pages.dev/api/cuenta \
  -H 'content-type: application/json' -d '{"accion":"cuota"}'   # 401 sesion
curl -s https://bitly-site.pages.dev/api/rescate                    # 401 sesion

# 2c. La app real y su CSP propia (tiene que traer wasm-unsafe-eval)
curl -s -D - -o /dev/null https://bitly-site.pages.dev/app/ | grep -i content-security

# 3. La demo entera, en un Chrome de verdad
DEMO_URL=https://bitly-site.pages.dev node scripts/verificar-demo.mjs

# 3b. El audio de nicho de punta a punta: búsqueda → clic real → suena (el
#     canal de YouTube; falla si el extractor deja de devolver formatos)
YATTEE_URL=https://yattee-server-2j61.onrender.com \
  node scripts/verificar-audio-nicho.mjs

# 4. El canje Premium contra el registro real. Necesita un código con estado
#    "usado" y, para probar el camino feliz, uno con estado "activo" (sólo
#    lectura: el sitio nunca marca códigos, así que el activo sigue activo).
#    Se sacan de scripts/.cache/codes.json, que está en .gitignore, y se pasan
#    por entorno: nunca se imprimen ni se guardan en el repo.
DEMO_URL=https://bitly-site.pages.dev CODIGO_USADO=<código> \
  CODIGO_ACTIVO=<código> node scripts/probar-premium.mjs
```

Corrido el 2026-10-28 contra `bitly-site.pages.dev`: la demo da **23/23** (dos
veces seguidas) y `/app` monta Flutter con canvaskit desde gstatic. La única
que costó fue el karaoke: LRCLIB tarda 5–9 s desde el edge y contesta 429 por la
IP compartida del Worker, así que `src/server/letras.ts` le da 9 s a la primera
consulta, reintenta los 429/5xx y **no** cachea los fallos (si no, los tres
reintentos del karaoke contestaban lo mismo y el «♪» quedaba pegado).

El contrato de la cuenta con la app (alta, código, sesión, cuota, descarga y
rescate) se prueba sin red ni base real: `pnpm probar:api-cuenta` (29
aserciones, handlers reales de `/api/cuenta` y `/api/rescate`).

El panel de rescate de «Mi cuenta» —los canales sin pérdida administrables
desde la web, los mismos que la app trae en Ajustes → Descargas → Rescate— se
prueba en un Chrome real con una cuenta sembrada: `pnpm verificar:rescate-cuenta`
abre el panel, guarda espejos e instancias propias, comprueba en la base del
sitio que quedaron (normalizados y sin ningún secreto de la app), vuelve a
abrirlo para ver lo guardado, lo borra y verifica que una URL inválida no deje
un guardado a medias. Usa el repo de PRUEBA de datos y limpia lo que sembró.

El punto 4 son 9 aserciones: las server functions responden 200 (no 500), el
estado que devuelve el servidor es el real del registro, un código usado **no**
deja Premium guardado y un código activo sí lo activa (después se limpia del
perfil de prueba).

### 6.1 Auditoría completa de producción

`pnpm verificar:produccion` recorre el despliegue real **sin escribir nada**: no
crea cuentas, pedidos ni egresos. Revisa cabeceras de seguridad y CSP en `/` y
`/admin/`, rutas privadas y fugas (`/_ssr/`, `/_worker.js`, `.env`, `.git`,
`package.json`, source maps), el HTML del panel (noindex y sin correo, token ni
clave), la RPC (403 por GET, `no-store`, corte de 7 MB con 413), el acceso al
panel con un token inventado y con la clave equivocada, la consistencia de las
métricas, caché y compresión, el service worker, el manifiesto PWA y el 404.

La parte que entra al panel necesita el correo y la clave del dueño, y sin ellos
se salta ese bloque (avisa y sigue con el resto):

```bash
# sólo lectura; correo y clave van por entorno y nunca se imprimen
BITLY_ADMIN_EMAIL='<correo del dueño>' BITLY_ADMIN_CLAVE='<clave del panel>' \
  node scripts/auditoria-produccion.mjs

# contra otro despliegue (por ejemplo un preview)
PROD_URL=https://<hash>.bitly-site.pages.dev BITLY_ADMIN_EMAIL='<correo>' \
  BITLY_ADMIN_CLAVE='<clave>' node scripts/auditoria-produccion.mjs
```

Termina con `PRODUCCIÓN: TODO OK` y código 0, o con la lista de `FALLA` y
código 1. Conviene correrla después de cada deploy.

**Si el build falla, no despliegues.** El prerender levanta un servidor local y en
Windows a veces se cae (`ETIMEDOUT`/`ECONNREFUSED` contra `127.0.0.1:puerto`);
cuando pasa, `vite build` termina pero `scripts/cloudflare-worker.mjs` no corre y
`dist/client` queda **sin `_worker.js`**: todo el sitio pasa a estáticos y las
server functions responden 405. Volvé a compilar (`rm -rf dist .output && pnpm
build`) y confirmá que exista `dist/client/_worker.js` antes de publicar.

Si el punto 2 devuelve **405**, el build volvió a publicar sólo estáticos: falta
el `_worker.js` (¿se rompió el `build`?).

Si el punto 4 dice "El registro no respondió", el problema es de entorno, no del
registro: revisá que `BITLY_CODES_TOKEN` esté en las env vars, que
`nodejs_compat` esté activo y que la `compatibility_date` sea reciente (ver la
sección 3 sobre la siembra).
