import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteTsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // ✅ Esto es clave: habilita SSG estático
      prerender: {
        enabled: true,
        // Opcional: define rutas a pre-renderizar
        // routes: ['/']
      },
    }),
    react(),
    viteTsconfigPaths(),
  ],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});