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

Las carpetas que empiezan con `_` **no se publican como estáticos**, así que
`_worker.js` y `_ssr/` no quedan descargables.

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

Sin esto las `SUPABASE_*` y el `BITLY_CODES_TOKEN` no llegan al SSR: la búsqueda
funciona (no las usa) pero el canje de códigos responde "no pudimos verificar"
y el SSR de Supabase queda sin credenciales. Nota: `process` **sólo existe** con
`nodejs_compat`, y `process.env` sólo se puebla desde `env` con una
`compatibility_date` reciente — con `2024-09-23` venía vacío.

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
| `VITE_SUPABASE_*`, `SUPABASE_*` | Las que ya usa el sitio. |

Se cargan en **Pages → Settings → Environment variables**. No hay que prefijar
`BITLY_CODES_TOKEN` con `VITE_` (eso la mandaría al navegador).

Para probar el canje en local alcanza con tenerla en `.env` y correr el server
de desarrollo (`pnpm dev`): ahí las server functions corren en Node y leen
`process.env` directo. Con `wrangler pages dev` el `.dev.vars` de la raíz no
llega al `env` del runtime — es una limitación de ese comando, no del deploy.

## 5. Comprobar que quedó bien

```bash
# 1. La landing responde
curl -s -o /dev/null -w "%{http_code}\n" https://bitly-site.pages.dev/

# 2. Las server functions existen (403 = existe y pide Origin; 405 = NO está)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://bitly-site.pages.dev/_serverFn/abc" -H "x-tsr-serverfn: true"

# 3. La demo entera, en un Chrome de verdad
DEMO_URL=https://bitly-site.pages.dev node scripts/verificar-demo.mjs

# 4. El canje Premium contra el registro real. Necesita un código con estado
#    "usado" (sólo lectura: el sitio nunca marca códigos).
DEMO_URL=https://bitly-site.pages.dev CODIGO_USADO=<código> \
  node scripts/probar-premium.mjs
```

Si el punto 2 devuelve **405**, el build volvió a publicar sólo estáticos: falta
el `_worker.js` (¿se rompió el `build`?).

Si el punto 4 dice "El registro no respondió", el problema es de entorno, no del
registro: revisá que `BITLY_CODES_TOKEN` esté en las env vars, que
`nodejs_compat` esté activo y que la `compatibility_date` sea reciente (ver la
sección 3 sobre la siembra).
