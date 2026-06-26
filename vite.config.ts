import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api/* to the Express backend so the browser talks same-origin
    // (no CORS juggling, and the API URL never gets hard-coded in the frontend).
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
