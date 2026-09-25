import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * The single-page app. In development Vite serves it on :3000 and forwards the
 * server's paths (API, Logto sign-in/out/callback, the roadmap page) to the Hono
 * server on API_PORT — see server/dev.ts. In production the Hono server serves
 * the built `dist/` itself.
 */
export default defineConfig(({ mode }) => {
  const api = `http://127.0.0.1:${loadEnv(mode, import.meta.dirname, '').API_PORT ?? '3002'}`;
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': import.meta.dirname } },
    // NEXT_PUBLIC_ kept so existing deploy config (PostHog build args) works unchanged.
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    server: {
      port: 3000,
      strictPort: true,
      // changeOrigin off: the server must see the browser's host (localhost:3000) so its
      // redirects and cookies stay on the app's origin, not the API port.
      proxy: Object.fromEntries(
        ['/api/', '/sign-in', '/sign-out', '/callback', '/roadmap'].map((p) => [
          p,
          { target: api, changeOrigin: false },
        ]),
      ),
    },
  };
});
