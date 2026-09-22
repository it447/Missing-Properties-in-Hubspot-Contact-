import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // npm run dev:api runs the same api/*.js handlers under plain Node.
      '/api': 'http://localhost:3001',
    },
  },
})
