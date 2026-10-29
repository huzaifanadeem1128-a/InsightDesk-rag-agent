import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy all backend API calls to FastAPI on :8000.
      // This means the frontend can call `/auth/login` instead of
      // `http://127.0.0.1:8000/auth/login`, and there are no CORS issues.
      '/auth': 'http://127.0.0.1:8000',
      '/chat': 'http://127.0.0.1:8000',
      '/chats': 'http://127.0.0.1:8000',
      '/messages': 'http://127.0.0.1:8000',
      '/documents': 'http://127.0.0.1:8000',
      '/rag': 'http://127.0.0.1:8000',
      // Admin API — specific paths only, so `/admin` (frontend route)
      // falls through to Vite and React Router handles it.
      '/admin/overview': 'http://127.0.0.1:8000',
      '/admin/users': 'http://127.0.0.1:8000',
      '/admin/audit': 'http://127.0.0.1:8000',
    },
  },
})