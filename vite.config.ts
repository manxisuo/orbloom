import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// GitHub Pages project site: https://manxisuo.github.io/orbloom/
export default defineConfig({
  plugins: [vue()],
  base: '/orbloom/',
})
