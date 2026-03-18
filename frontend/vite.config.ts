import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/instance': 'http://localhost:3000',
      '/message': 'http://localhost:3000',
      '/chat': 'http://localhost:3000',
      '/group': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
      '/events': { target: 'http://localhost:3000', ws: false },
      '/config': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/ai': 'http://localhost:3000',
      '/knowledge': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
})
