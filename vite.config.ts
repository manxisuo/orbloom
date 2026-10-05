import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Vercel / local: `/`. GitHub Pages project site needs `/orbloom/` via BASE_PATH.
export default defineConfig({
  plugins: [vue()],
  base: process.env.BASE_PATH || '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
})
