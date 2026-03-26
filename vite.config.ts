import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Deploy to subpath: https://example.com/memoapp/
  base: '/memoapp/',
})
