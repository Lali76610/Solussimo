#!/usr/bin/env node
/**
 * Applique les migrations de supabase/migrations sur un projet Supabase via
 * l'API de gestion (sans CLI, sans connexion directe à la base).
 *
 *   SUPABASE_ACCESS_TOKEN=… node scripts/supabase-migrate.mjs <project-ref> [--dry-run]
 *
 * - Idempotent : les versions déjà présentes dans
 *   supabase_migrations.schema_migrations (registre de la CLI Supabase) sont ignorées.
 * - Chaque migration est appliquée dans une transaction avec son enregistrement.
 * - Refuse tout projet dont le nom ne se termine pas par « -dev », « -demo » ou
 *   « -staging », sauf si SOLUSSIMO_ALLOW_PROD=1 (garde-fou production).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [ref, flag] = process.argv.slice(2)
const dryRun = flag === '--dry-run'
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
  console.error('Usage : node scripts/supabase-migrate.mjs <project-ref> [--dry-run]')
  process.exit(2)
}
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN manquant.')
  process.exit(2)
}

const API = `https://api.supabase.com/v1/projects/${ref}`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

async function query(sql) {
  const res = await fetch(`${API}/database/query`, { method: 'POST', headers, body: JSON.stringify({ query: sql }) })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${body.slice(0, 800)}`)
  return JSON.parse(body)
}

const project = await (await fetch(API, { headers })).json()
if (!project?.name) throw new Error(`Projet introuvable : ${JSON.stringify(project).slice(0, 200)}`)
if (!/-(dev|demo|staging)$/.test(project.name) && process.env.SOLUSSIMO_ALLOW_PROD !== '1') {
  console.error(`⛔ « ${project.name} » ne ressemble pas à un projet de développement. Arrêt (garde-fou production).`)
  process.exit(3)
}
console.log(`▶ Projet ${project.name} (${project.region})${dryRun ? ' — simulation' : ''}`)

await query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text
  );`)
const applied = new Set((await query('select version from supabase_migrations.schema_migrations')).map((r) => r.version))

const dir = 'supabase/migrations'
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort()
for (const file of files) {
  const [, version, name] = file.match(/^(\d{14})_(.+)\.sql$/)
  if (applied.has(version)) {
    console.log(`  · ${file} — déjà appliquée`)
    continue
  }
  if (dryRun) {
    console.log(`  · ${file} — serait appliquée`)
    continue
  }
  const sql = readFileSync(join(dir, file), 'utf8')
  const dollar = '$solussimo_migration$'
  await query(`begin;
${sql}
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('${version}', '${name}', array[${dollar}${sql}${dollar}]);
commit;`)
  console.log(`  ✔ ${file}`)
}
console.log('✔ Migrations à jour.')
