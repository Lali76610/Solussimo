import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { checkBrowserKey, checkSupabaseUrl } from './keyGuard'

/**
 * Client Supabase du navigateur.
 *  - N'utilise QUE la clé publique (anon / publishable). Toute la sécurité
 *    d'accès aux données repose sur les politiques RLS côté PostgreSQL.
 *  - Si la configuration est absente ou invalide, le client vaut null :
 *    l'application reste utilisable en mode démonstration.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const urlCheck = checkSupabaseUrl(url)
const keyCheck = checkBrowserKey(key)

export const supabaseConfigIssue: string | null = !urlCheck.ok
  ? `url:${urlCheck.reason}`
  : !keyCheck.ok
    ? `key:${keyCheck.reason}`
    : null

if (supabaseConfigIssue && (url || key)) {
  // Configuration partielle ou invalide : on le signale sans jamais afficher la clé.
  console.warn(`[SOLUSSIMO] Supabase désactivé (${supabaseConfigIssue}).`)
}

export const supabase: SupabaseClient<Database> | null =
  supabaseConfigIssue === null
    ? createClient<Database>(url!, key!, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
          storageKey: 'solussimo.auth',
        },
      })
    : null

export const isSupabaseConfigured = supabase !== null
