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

Compatibilidad: `compatibility_date = "2024-09-23"` y
`compatibility_flags = ["nodejs_compat"]` (esto último es lo que permite leer
`process.env` en el Worker).

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

Verificado en local con el runtime real:

```bash
pnpm build
npx wrangler pages dev dist/client --port 8799 \
  --compatibility-date=2024-09-23 --compatibility-flags=nodejs_compat

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

## 5. Comprobar que quedó bien

```bash
# 1. La landing responde
curl -s -o /dev/null -w "%{http_code}\n" https://bitly-site.pages.dev/

# 2. Las server functions existen (403 = existe y pide Origin; 405 = NO está)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://bitly-site.pages.dev/_serverFn/abc" -H "x-tsr-serverfn: true"

# 3. La demo entera, en un Chrome de verdad
DEMO_URL=https://bitly-site.pages.dev node scripts/verificar-demo.mjs
```

Si el punto 2 devuelve **405**, el build volvió a publicar sólo estáticos: falta
el `_worker.js` (¿se rompió el `postbuild`?).
