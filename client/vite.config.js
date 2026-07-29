import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/proxy': 'http://localhost:3000',
      '/data': 'http://localhost:3000',
      '/bios': 'http://localhost:3000'
    }
  }
})
