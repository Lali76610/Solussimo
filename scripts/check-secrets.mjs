#!/usr/bin/env node
/**
 * Détecte la présence de secrets Supabase (ou génériques) dans :
 *  - les fichiers suivis par git (le dépôt) ;
 *  - le build de production (dist/), c'est-à-dire ce qui part au navigateur.
 * Échoue (code 1) à la moindre découverte. Utilisé en CI.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const findings = []
const IGNORED = new Set(['package-lock.json'])

const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/g, 'clé secrète Supabase (sb_secret_)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'clé privée'],
  [/(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY)\s*[=:]\s*['"]?[A-Za-z0-9._-]{20,}/g, 'variable service_role renseignée'],
  [/postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)[^\s'"]+/g, 'URL de base de données avec mot de passe'],
]

function jwtRole(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role
  } catch {
    return null
  }
}

function scan(file, content) {
  for (const [re, label] of PATTERNS) {
    for (const m of content.matchAll(re)) findings.push(`${file}: ${label} → ${m[0].slice(0, 24)}…`)
  }
  for (const m of content.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    const role = jwtRole(m[0])
    if (role && role !== 'anon') findings.push(`${file}: JWT avec role=${role}`)
  }
}

// 1) Dépôt
const tracked = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter(Boolean)
for (const file of tracked) {
  if (IGNORED.has(file) || !existsSync(file) || statSync(file).size > 2_000_000) continue
  if (/^\.env(\..*)?$/.test(file.split('/').pop()) && !file.endsWith('.env.example')) {
    findings.push(`${file}: fichier .env versionné`)
    continue
  }
  scan(file, readFileSync(file, 'utf8'))
}

// 2) Build de production
function walk(dir) {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
}
if (existsSync('dist')) {
  for (const file of walk('dist')) {
    scan(file, readFileSync(file, 'utf8'))
  }
}

if (findings.length) {
  console.error('✖ Secrets potentiels détectés :\n  ' + findings.join('\n  '))
  process.exit(1)
}
console.log(`✔ Aucun secret détecté (${tracked.length} fichiers suivis${existsSync('dist') ? ' + dist/' : ''}).`)
