/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Playwright's end-to-end specs live in e2e/ and run separately.
  test: { exclude: ['e2e/**', 'node_modules/**'] },
})
