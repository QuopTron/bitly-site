import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Source maps: sin ellos Lighthouse baja "best practices" con
  // "missing source maps for large first-party JavaScript". Sólo se descargan
  // con las devtools abiertas, así que no pesan para el visitante.
  build: {
    sourcemap: true,
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
  server: {
    // Los harness de `scripts/` (y las capturas) escriben sus bundles y fotos
    // dentro del árbol: sin esto, cada archivo dispara un page reload que deja
    // la pestaña en blanco justo cuando se está verificando algo.
    watch: {
      ignored: ["**/scripts/.cache/**", "**/.capturas-perfil*/**"],
    },
  },
});