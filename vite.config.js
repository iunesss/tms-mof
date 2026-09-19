import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { globSync } from 'node:fs';

// إدراج جميع صفحات الأدوار في البناء متعدد الصفحات.
const pageInputs = Object.fromEntries(
  globSync('src/**/*.html').map((file) => [
    file.replace(/[\\/]/g, '-').replace(/\.html$/, ''),
    resolve(import.meta.dirname, file),
  ])
);

export default defineConfig({
  plugins: [tailwindcss()],

  server: {
    open: 'src/login/index.html',
    port: 5173,
    fs: {
      // الباك إند داخل جذر المشروع؛ نمنع تجاوز حماية الملفات عبر خادم Vite.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/backend/**', '**/uploads/**'],
    },
    proxy: {
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },

  build: {
    rollupOptions: { input: pageInputs },
  },
});
