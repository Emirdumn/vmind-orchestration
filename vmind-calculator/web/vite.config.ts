import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Arayüz, API sunucusuyla AYNI origin'den servis edilir (Node sunucusu
 * `web/dist`'i statik olarak sunar). Bu yüzden CORS yok, çerez `SameSite=Strict`
 * kalabiliyor ve sunucunun CSP başlığı `connect-src 'self'` diyebiliyor.
 *
 * Geliştirmede Vite ayrı portta çalışır; `/api` istekleri sunucuya vekillenir
 * ki tarayıcı yine tek origin görsün.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env['VITE_API_TARGET'] ?? 'http://127.0.0.1:8080',
        changeOrigin: false,
      },
    },
  },
});
