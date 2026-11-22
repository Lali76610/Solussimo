/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { checkBrowserKey } from './src/lib/keyGuard.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  // Sécurité : refuse de construire si une clé secrète Supabase serait embarquée.
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue
    const check = checkBrowserKey(value)
    if (!check.ok && (check.reason === 'secret_key' || check.reason === 'service_role_key')) {
      throw new Error(`[sécurité] ${name} contient une clé Supabase SECRÈTE (${check.reason}). Utilisez la clé publique anon/publishable.`)
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    build: {
      // Pas de source maps en production : on n'expose pas le code source.
      sourcemap: false,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    },
  }
})
