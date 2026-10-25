import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5174,
    strictPort: false,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 8888}` } },
  },
  esbuild: {
    drop: ['debugger'],
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
});
