import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

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
    rollupOptions: {
      input: {
        login: resolve(import.meta.dirname, 'src/login/index.html'),
        unauthorized: resolve(import.meta.dirname, 'src/login/unauthorized.html'),
        adminDashboard: resolve(import.meta.dirname, 'src/admin/dashboard.html'),
        courseManagerDashboard: resolve(import.meta.dirname, 'src/course-manager/dashboard.html'),
        agentDashboard: resolve(import.meta.dirname, 'src/agent/dashboard.html'),
        managerDashboard: resolve(import.meta.dirname, 'src/manager/dashboard.html'),
        employeeDashboard: resolve(import.meta.dirname, 'src/employee/dashboard.html'),
      },
    },
  },
});
