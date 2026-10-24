import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // El prerender corre dentro de este proceso y necesita leer los datos del
  // sitio (repo privado de GitHub) para salir en el HTML. Vite sólo inyecta al
  // cliente las variables con prefijo VITE_, y el token NO puede tenerlo: el
  // prefijo lo mandaría al bundle. Así que se copian las de servidor a
  // process.env, que es lo que lee `src/server/github-store.ts`.
  //
  // Ojo: esto toca el proceso de build, no el bundle. El token nunca aparece en
  // dist/client — se comprueba con `node scripts/auditar.mjs` y con buscar el
  // valor literal en dist/client después de compilar.
  const entorno = loadEnv(mode, process.cwd(), '');
  for (const [clave, valor] of Object.entries(entorno)) {
    if (typeof valor === 'string' && process.env[clave] === undefined) process.env[clave] = valor;
  }

  return {
    // Source maps: sin ellos Lighthouse baja "best practices" con
    // "missing source maps for large first-party JavaScript". Sólo se descargan
    // con las devtools abiertas, así que no pesan para el visitante.
    build: {
      sourcemap: true,
      rolldownOptions: {
        // Módulo nativo de Cloudflare: existe en producción pero no en el
        // build local, así que se deja como import externo.
        // `node:tls` lo importa el cliente SMTP de desarrollo (`correo.ts`) sólo
        // cuando worker-mailer no existe, o sea en Node. En el worker nunca se
        // ejecuta, pero el bundler no tiene que intentar resolverlo.
        external: ["cloudflare:sockets", "node:tls"],
      },
    },
    plugins: [
      tailwindcss(),
      tanstackStart({
        prerender: {
          enabled: true
        }
      }),
      react(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    ssr: {
      // `worker-mailer` importa `cloudflare:sockets`, que sólo existe en el
      // runtime de Cloudflare. Hay que inlinearlo en el bundle del worker:
      // si queda como import dinámico externo, en producción no se resuelve
      // (no hay node_modules en Pages).
      noExternal: ["worker-mailer"],
    },
    server: {
      // Los harness de `scripts/` (y las capturas) escriben sus bundles y fotos
      // dentro del árbol: sin esto, cada archivo dispara un page reload que deja
      // la pestaña en blanco justo cuando se está verificando algo.
      watch: {
        ignored: ["**/scripts/.cache/**", "**/.capturas-perfil*/**"],
      },
    },
  };
});