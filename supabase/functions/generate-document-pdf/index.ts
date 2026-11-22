// SOLUSSIMO — Edge Function « generate-document-pdf »
// Génère le PDF d'une pièce (reçu, facture, avoir, acompte, ticket Z) CÔTÉ SERVEUR.
// · Appelée avec le JWT de l'utilisateur : get_document applique les mêmes droits que l'application
//   (RLS, isolation entreprise, D6) et journalise chaque génération (mention DUPLICATA dès la 2e).
// · N'utilise JAMAIS la clé service_role.
// · Aucune donnée n'est stockée : le PDF est renvoyé directement.
import { createClient } from '@supabase/supabase-js'
import { renderDocumentPdf, type DocLabels, type DocumentData } from '../_shared/renderDocument.ts'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? ''
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCALES = new Set(['fr-FR', 'en-GB', 'es-ES', 'de-DE', 'fr-CH', 'de-CH', 'fr-BE'])

Deno.serve(async (req) => {
  const headers = cors(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405, headers })
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return new Response('not_authenticated', { status: 401, headers })

  let body: { kind?: string; id?: string; locale?: string; labels?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return new Response('invalid_input', { status: 400, headers })
  }
  if (!['receipt', 'invoice', 'closure'].includes(body.kind ?? '') || !UUID.test(body.id ?? '')) {
    return new Response('invalid_input', { status: 400, headers })
  }
  // Libellés fournis par l'application (traductions) : chaînes courtes uniquement.
  const labels = Object.fromEntries(
    Object.entries(body.labels ?? {}).filter(([k, v]) => /^[a-zA-Z]{1,30}$/.test(k) && typeof v === 'string' && v.length <= 160),
  ) as unknown as DocLabels
  const locale = LOCALES.has(body.locale ?? '') ? body.locale! : 'fr-FR'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('get_document', { p_kind: body.kind, p_id: body.id })
  if (error) {
    const status = error.code === '42501' ? 403 : 400
    return new Response(status === 403 ? 'forbidden' : 'invalid_input', { status, headers })
  }
  const pdf = await renderDocumentPdf(data as DocumentData, labels, locale)
  return new Response(pdf, {
    headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${(data as DocumentData).document_no}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
})
