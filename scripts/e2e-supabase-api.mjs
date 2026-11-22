#!/usr/bin/env node
/**
 * Test de bout en bout de l'isolation multi-tenant via la VRAIE API Supabase
 * (Auth + REST + RLS) d'un projet de DÉVELOPPEMENT.
 *
 *   SUPABASE_ACCESS_TOKEN=… VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… \
 *     node scripts/e2e-supabase-api.mjs <project-ref>
 *
 * Crée deux comptes FICTIFS (@test.example, mots de passe aléatoires non conservés),
 * vérifie qu'aucune entreprise ne peut accéder aux données de l'autre, puis
 * supprime toutes les données créées (même en cas d'échec).
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'

const ref = process.argv[2]
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!ref || !url || !key || !token) {
  console.error('Paramètres manquants (ref, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN).')
  process.exit(2)
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SQL HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

let passed = 0
function ok(cond, msg) {
  if (!cond) throw new Error(`ÉCHEC: ${msg}`)
  passed++
  console.log(`  ok ${String(passed).padStart(2)} - ${msg}`)
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const run = randomBytes(4).toString('hex')
const users = ['alice', 'bob'].map((n) => ({
  name: n,
  id: randomUUID(),
  email: `e2e-${n}-${run}@test.example`,
  password: `Aa1-${randomBytes(18).toString('base64url')}`,
}))

async function createUsers() {
  for (const u of users) {
    await sql(`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${lit(u.id)}, 'authenticated', 'authenticated', ${lit(u.email)},
        extensions.crypt(${lit(u.password)}, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', ${lit(JSON.stringify({ display_name: `E2E ${u.name}`, locale: 'fr' }))},
        now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), ${lit(u.id)}, ${lit(u.id)}, 'email',
        ${lit(JSON.stringify({ sub: u.id, email: u.email, email_verified: true }))}, now(), now(), now());`)
  }
}

async function cleanup() {
  const ids = users.map((u) => lit(u.id)).join(',')
  await sql(`
    delete from public.appointments where company_id in (select id from public.companies where created_by in (${ids}));
    delete from public.client_health_notes where company_id in (select id from public.companies where created_by in (${ids}));
    delete from public.client_consents where company_id in (select id from public.companies where created_by in (${ids}));
    delete from public.services where company_id in (select id from public.companies where created_by in (${ids}));
    delete from public.companies where created_by in (${ids});
    delete from auth.users where id in (${ids});`)
  const [left] = await sql(`select (select count(*) from auth.users where email like 'e2e-%@test.example') as users,
    (select count(*) from public.companies where name like 'E2E %') as companies`)
  console.log(`▶ Nettoyage : ${left.users} compte(s) et ${left.companies} entreprise(s) de test restants`)
}

const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

try {
  console.log(`▶ Comptes fictifs (run ${run})`)
  await createUsers()
  const [alice, bob] = users.map(() => client())
  const anon = client()

  for (const [c, u] of [[alice, users[0]], [bob, users[1]]]) {
    const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password })
    ok(!error, `Supabase Auth : connexion réelle de ${u.name} ${error ? error.message : ''}`)
  }
  const { error: badLogin } = await anon.auth.signInWithPassword({ email: users[0].email, password: 'Mauvais-Mdp-123' })
  ok(badLogin?.code === 'invalid_credentials', 'mauvais mot de passe refusé (message générique)')

  const { data: weak } = await anon.auth.signUp({ email: `e2e-weak-${run}@test.example`, password: 'faible' })
    .catch((e) => ({ data: null, error: e }))
  ok(!weak?.user, 'politique de mot de passe appliquée côté serveur (mot de passe faible refusé)')

  const mk = (c, n) => c.rpc('create_company_with_establishment', {
    p_company_name: `E2E Salon ${n} ${run}`, p_establishment_name: `E2E Etab ${n}`, p_kind: 'hair_salon',
    p_country_code: 'FR', p_city: 'Lyon', p_timezone: 'Europe/Paris', p_locale: 'fr', p_currency: 'EUR' })
  const a = await mk(alice, 'A'); ok(!a.error && a.data, 'Alice crée son salon via RPC')
  const b = await mk(bob, 'B'); ok(!b.error && b.data, 'Bob crée son salon via RPC')
  const companyA = a.data

  const { data: perms } = await alice.rpc('my_permissions', { p_company_id: companyA })
  ok(perms?.includes('company.delete'), 'Alice est propriétaire de son entreprise (permissions)')

  const { data: estA } = await alice.from('establishments').select('id').eq('company_id', companyA).single()
  const add = await alice.from('staff_members').insert({ company_id: companyA, establishment_id: estA.id, display_name: 'E2E Collaborateur', job: 'stylist' })
  ok(!add.error, 'Alice ajoute un collaborateur dans son entreprise')

  // ----- Bob tente d'accéder à l'entreprise d'Alice
  const bc = await bob.from('companies').select('id')
  ok(!bc.error && bc.data.length === 1 && bc.data[0].id === b.data, 'Bob ne voit que sa propre entreprise')
  for (const table of ['companies', 'establishments', 'staff_members', 'memberships', 'audit_log']) {
    const col = table === 'companies' ? 'id' : 'company_id'
    const r = await bob.from(table).select('*').eq(col, companyA)
    ok(!r.error && r.data.length === 0, `Bob : ${table} d'Alice invisibles via l'API`)
  }
  const up = await bob.from('companies').update({ name: 'Piraté' }).eq('id', companyA).select()
  ok(!up.error && up.data.length === 0, 'Bob : modification de l\'entreprise d\'Alice sans effet')
  const del = await bob.from('staff_members').delete().eq('company_id', companyA).select()
  ok(!del.error && del.data.length === 0, 'Bob : suppression des collaborateurs d\'Alice sans effet')
  const ins = await bob.from('staff_members').insert({ company_id: companyA, establishment_id: estA.id, display_name: 'Intrus', job: 'stylist' })
  ok(ins.error?.code === '42501', 'Bob : insertion d\'un collaborateur chez Alice refusée (RLS)')
  const self = await bob.from('memberships').insert({ company_id: companyA, user_id: users[1].id, role: 'owner' })
  ok(Boolean(self.error), 'Bob : auto-adhésion à l\'entreprise d\'Alice refusée')
  const delA = await bob.rpc('delete_company', { p_company_id: companyA, p_confirm_name: `E2E Salon A ${run}` })
  ok(Boolean(delA.error), 'Bob : suppression de l\'entreprise d\'Alice refusée')
  const exp = await bob.rpc('export_my_data')
  ok(!exp.error && !JSON.stringify(exp.data).includes('Salon A'), 'Bob : export RGPD sans aucune donnée d\'Alice')

  // ----- V0.3 : Personnel & Planning via l'API réelle
  const { data: staffA } = await alice.from('staff_members').select('id').eq('company_id', companyA).eq('display_name', 'E2E Collaborateur').single()
  const sch = await alice.rpc('set_staff_week_schedule', { p_staff_id: staffA.id, p_establishment_id: estA.id,
    p_slots: [1, 2, 3, 4, 5, 6].flatMap((d) => [{ weekday: d, start: '09:00', end: '12:30' }, { weekday: d, start: '13:30', end: '19:00' }]) })
  ok(!sch.error, 'Planning : horaires hebdomadaires enregistrés (RPC)')
  const svc = await alice.from('services').insert({ company_id: companyA, name: 'E2E Coupe', duration_minutes: 30, price_cents: 3200 }).select('id').single()
  ok(!svc.error, 'Planning : prestation créée')
  const book = (c, time, label) => c.rpc('book_appointment', { p_establishment_id: estA.id, p_staff_id: staffA.id, p_service_id: svc.data.id, p_start_local: time, p_client_label: label })
  const b1 = await book(alice, '2030-01-07T10:00:00', 'E2E Client 1')
  ok(!b1.error, 'Planning : rendez-vous réservé (lundi 07/01/2030 10:00)')
  const { data: appt } = await alice.from('appointments').select('starts_at, version').eq('id', b1.data).single()
  ok(appt && new Date(appt.starts_at).toISOString() === '2030-01-07T09:00:00.000Z', 'Planning : heure de Paris convertie côté serveur (09:00 UTC)')
  const dbl = await book(alice, '2030-01-07T10:15:00', 'E2E Doublon')
  ok(/slot_unavailable/.test(dbl.error?.message ?? ''), 'Planning : double réservation refusée par le serveur')
  const brk = await book(alice, '2030-01-07T12:30:00', 'E2E Pause')
  ok(/outside_working_hours/.test(brk.error?.message ?? ''), 'Planning : réservation pendant la pause refusée')
  const mv = await alice.rpc('reschedule_appointment', { p_appointment_id: b1.data, p_start_local: '2030-01-07T15:00:00', p_expected_version: appt.version })
  ok(!mv.error && mv.data === appt.version + 1, 'Planning : déplacement avec contrôle de version')
  const stale = await alice.rpc('cancel_appointment', { p_appointment_id: b1.data, p_expected_version: appt.version })
  ok(/version_conflict/.test(stale.error?.message ?? ''), 'Planning : version périmée refusée (concurrence optimiste)')
  const ba = await bob.from('appointments').select('id').eq('company_id', companyA)
  ok(!ba.error && ba.data.length === 0, 'Bob : rendez-vous d\'Alice invisibles')
  const bb = await book(bob, '2030-01-08T10:00:00', 'E2E Intrus')
  ok(Boolean(bb.error), 'Bob : réservation chez Alice refusée')
  const bh = await bob.from('staff_working_hours').select('id').eq('company_id', companyA)
  ok(!bh.error && bh.data.length === 0, 'Bob : horaires d\'Alice invisibles')
  const bi = await bob.rpc('create_invitation', { p_company_id: companyA, p_email: 'x@test.example', p_role: 'staff' })
  ok(Boolean(bi.error), 'Bob : invitation dans l\'entreprise d\'Alice refusée')
  const ai = await alice.rpc('create_invitation', { p_company_id: companyA, p_email: `e2e-invite-${run}@test.example`, p_role: 'staff' })
  ok(!ai.error && /^[0-9a-f]{64}$/.test(ai.data?.[0]?.token ?? ''), 'Invitation : jeton sécurisé généré')
  const leak = await alice.from('invitations').select('token_hash')
  ok(Boolean(leak.error), 'Invitation : hachage du jeton illisible via l\'API')
  const direct = await alice.from('appointments').insert({ company_id: companyA })
  ok(Boolean(direct.error), 'Rendez-vous : écriture directe refusée (RPC obligatoire)')

  // ----- V0.4 : Clients via l'API réelle
  const cl = await alice.from('clients').insert({ company_id: companyA, home_establishment_id: estA.id, first_name: 'E2E Léa', last_name: 'Bernard',
    email: `e2e-client-${run}@exemple.example`, phone_e164: '+33639980001' }).select('id, email_masked, phone_masked').single()
  ok(!cl.error && cl.data.phone_masked === '+33 •• •• 00 01', 'Clients : fiche créée, coordonnées masquées renvoyées')
  const raw = await alice.from('clients').select('email').eq('id', cl.data.id)
  ok(Boolean(raw.error), 'Clients (D2) : e-mail en clair illisible via l\'API, même pour le propriétaire')
  const rv = await alice.rpc('reveal_client_contact', { p_client_id: cl.data.id })
  ok(!rv.error && rv.data?.[0]?.phone_e164 === '+33639980001', 'Clients (D2) : affichage complet par le serveur (journalisé)')
  const sr = await alice.rpc('search_clients', { p_company_id: companyA, p_query: 'lea bernrd' })
  ok(!sr.error && sr.data.some((c) => c.id === cl.data.id), 'Clients : recherche tolérante (accents, faute de frappe)')
  const bc2 = await bob.from('clients').select('id').eq('company_id', companyA)
  ok(!bc2.error && bc2.data.length === 0, 'Bob : clients d\'Alice invisibles')
  const br = await bob.rpc('reveal_client_contact', { p_client_id: cl.data.id })
  ok(Boolean(br.error), 'Bob : coordonnées d\'un client d\'Alice refusées')
  const bs = await bob.rpc('search_clients', { p_company_id: companyA, p_query: 'lea' })
  ok(Boolean(bs.error), 'Bob : recherche dans le fichier d\'Alice refusée')
  const ks = await alice.from('client_consents').insert({ company_id: companyA, client_id: cl.data.id, purpose: 'marketing', channel: 'sms', status: 'granted' })
  ok(!ks.error, 'Clients : consentement SMS enregistré')
  const kd = await alice.from('client_consents').delete().eq('client_id', cl.data.id).select()
  ok(Boolean(kd.error) || kd.data.length === 0, 'Clients : consentements non supprimables (ajout seul)')
  const hs = await alice.rpc('set_client_health_notes', { p_client_id: cl.data.id, p_notes: { allergies: 'test' } })
  ok(Boolean(hs.error), 'Santé (D1) : refusé tant que la fonction n\'est pas activée')
  const he = await alice.rpc('set_health_data_enabled', { p_company_id: companyA, p_enabled: true, p_ack_consent: true, p_ack_dpia: true, p_ack_information: true })
  ok(!he.error, 'Santé (D1) : activation par le propriétaire avec confirmations légales')
  await alice.from('client_consents').insert({ company_id: companyA, client_id: cl.data.id, purpose: 'health_data', channel: 'none', status: 'granted', method: 'in_salon_signed' })
  const hw = await alice.rpc('set_client_health_notes', { p_client_id: cl.data.id, p_notes: { allergies: 'arachide-e2e' } })
  const hr = await alice.rpc('get_client_health_notes', { p_client_id: cl.data.id })
  ok(!hw.error && hr.data?.allergies === 'arachide-e2e', 'Santé (D3) : écriture chiffrée puis lecture déchiffrée (Vault réel)')
  const [enc] = await sql(`select position('arachide-e2e' in encode(ciphertext, 'escape')) as p from public.client_health_notes where client_id = ${lit(cl.data.id)}`)
  ok(Number(enc.p) === 0, 'Santé (D3) : aucun texte en clair stocké en base')
  const hb = await bob.rpc('get_client_health_notes', { p_client_id: cl.data.id })
  ok(Boolean(hb.error), 'Bob : données de santé d\'Alice refusées')
  const bk2 = await alice.rpc('book_appointment', { p_establishment_id: estA.id, p_staff_id: staffA.id, p_service_id: svc.data.id, p_start_local: '2030-01-08T10:00:00', p_client_id: cl.data.id })
  ok(!bk2.error, 'Planning : rendez-vous lié à la fiche client')
  const ex = await alice.rpc('export_client_data', { p_client_id: cl.data.id })
  ok(!ex.error && ex.data?.client?.phone === '+33639980001' && ex.data.appointments.length === 1, 'RGPD : export complet')
  const er = await alice.rpc('erase_client', { p_client_id: cl.data.id, p_confirm: true })
  const [anonRow] = await sql(`select status, first_name, email from public.clients where id = ${lit(cl.data.id)}`)
  ok(!er.error && anonRow.status === 'anonymized' && anonRow.first_name === null && anonRow.email === null, 'RGPD : anonymisation effective')
  const [logs] = await sql(`select count(*) filter (where action = 'contact_reveal') r, count(*) filter (where action = 'health_read') h, count(*) filter (where action = 'export') e from public.client_access_log where company_id = ${lit(companyA)}`)
  ok(Number(logs.r) >= 1 && Number(logs.h) >= 1 && Number(logs.e) >= 1, 'Journal des accès sensibles alimenté (affichage, santé, export)')

  // ----- Visiteur anonyme
  const an = await anon.from('companies').select('*')
  ok(Boolean(an.error) || an.data.length === 0, 'Anonyme : aucune entreprise lisible')
  const ar = await anon.rpc('create_company_with_establishment', {
    p_company_name: 'E2E Anonyme', p_establishment_name: 'X', p_kind: 'spa', p_country_code: 'FR',
    p_city: null, p_timezone: 'Europe/Paris', p_locale: 'fr', p_currency: 'EUR' })
  ok(Boolean(ar.error), 'Anonyme : création de salon refusée')
  const priv = await alice.schema('private').rpc('can', { p_company_id: companyA, p_permission: 'company.read' })
  ok(Boolean(priv.error), 'Schéma private non exposé par l\'API')

  // ----- Vérification côté serveur
  const [state] = await sql(`select name, (select count(*) from public.staff_members where company_id = ${lit(companyA)}) as staff
    from public.companies where id = ${lit(companyA)}`)
  ok(state.name === `E2E Salon A ${run}` && Number(state.staff) === 2, 'Entreprise d\'Alice intacte côté serveur')

  console.log(`✔ ${passed} vérifications de bout en bout réussies`)
} catch (e) {
  console.error(e.message)
  process.exitCode = 1
} finally {
  await cleanup().catch((e) => console.error('Nettoyage :', e.message))
}
