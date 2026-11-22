// E2E V0.5 Caisse — iPhone 14, application compilée + base PostgreSQL LOCALE réelle (RLS active) via le relais.
// Usage :
//   scripts/e2e-local/setup-e2e-db.sh
//   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=<jwt anon factice> npx vite build --outDir /var/tmp/dist-e2e
//   npx vite preview --outDir /var/tmp/dist-e2e --port 4179 &
//   node scripts/e2e-local/e2e-v05.cjs <dossier de sortie>
const { chromium, devices } = require('playwright')
const { createRelay } = require('./relay.cjs')
const APP = process.env.APP_URL || 'http://localhost:4179'
const OUT = process.argv[2] || '.'
const relay = createRelay(process.env.E2E_DATABASE_URL || 'postgres://postgres@localhost:54329/solussimo_e2e')
let cur
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) process.exitCode = 1 }
const q = async (sql, p = []) => (await relay.pool.query(sql, p)).rows
const errs = []

async function login(b, who) {
  const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'fr-FR', acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errs.push(`${who}: ${e.message}`))
  page.on('dialog', (d) => d.accept())
  await relay.attach(page)
  await page.goto(`${APP}/connexion`)
  await page.fill('#email', `${who}@test.example`)
  await page.fill('#password', 'MotDePasseFictif2026')
  await page.click('button[type=submit]')
  await page.waitForSelector('main >> text=Salon A')
  cur = page
  return { ctx, page }
}
async function download(page, action) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), action()])
  const path = `${OUT}/${d.suggestedFilename()}`
  await d.saveAs(path)
  return { name: d.suggestedFilename(), path }
}
async function pickClient(page, text, name) {
  await page.fill('#apClient', text)
  await page.click(`[role=option]:has-text("${name}")`)
  await page.waitForSelector(`[data-testid=picked-client]:has-text("${name}")`)
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })

;(async () => {
  const b = await chromium.launch()

  // ===================== Propriétaire (alice) : ouverture, vente mixte, reçu, facture
  const A = await login(b, 'alice')
  let p = A.page
  await p.goto(`${APP}/caisse`)
  await p.waitForSelector('[data-testid=uncertified-banner]')
  ok(true, 'bandeau « mode non certifié — données fictives » affiché')
  await p.click('button[aria-label^="Ajouter 20,00"]')
  await p.click('button[aria-label^="Ajouter 20,00"]')
  await p.click('button[aria-label^="Ajouter 10,00"]')
  ok((await p.innerText('[data-testid=count-total]')).includes('50,00'), 'comptage par coupures : 2 × 20 € + 1 × 10 € = 50,00 €')
  await shot(p, 'v05-1-ouverture')
  await p.click('[data-testid=open-register]')
  await p.waitForSelector('[data-testid=catalog]')
  ok((await q("select opening_float_cents from register_sessions where status = 'open'"))[0]?.opening_float_cents === '5000', 'session ouverte en base avec fond de caisse 50,00 €')

  await pickClient(p, 'Léa', 'Léa Bernard')
  await p.click('[data-testid=catalog] button:has-text("Coupe femme")')
  await p.click('[role=tab]:has-text("Produits")')
  await p.click('[data-testid=catalog] button:has-text("Shampooing")')
  ok((await p.innerText('[data-testid=cart-total]')).includes('63,00'), 'panier : 45,00 + 18,00 = 63,00 €')
  await shot(p, 'v05-2-panier')
  await p.click('[data-testid=pay]')
  await p.click('[data-testid=methods] button:has-text("Espèces")')
  await p.locator('input[aria-label="Montant Espèces"]').fill('20,00')
  await p.click('[data-testid=methods] button:has-text("Carte")')
  await p.locator('input[aria-label="Référence terminal (facultatif)"]').fill('4970101234567890')
  await p.click('[data-testid=confirm-payment]')
  await p.waitForSelector('text=Ne saisissez jamais le numéro de carte')
  ok(true, 'numéro de carte refusé avant envoi')
  await p.locator('input[aria-label="Référence terminal (facultatif)"]').fill('AUT-4821')
  await p.locator('[data-testid=tendered]').fill('50')
  ok((await p.innerText('[data-testid=change-due]')).includes('30,00'), 'rendu monnaie affiché : 30,00 €')
  await shot(p, 'v05-3-paiement-mixte')
  // Double appui : une seule vente (clé d'idempotence)
  await p.dblclick('[data-testid=confirm-payment]')
  await p.waitForSelector('[data-testid=receipt]')
  const docNo = await p.innerText('[data-testid=document-no]')
  ok(/^T-\d{4}-000001$/.test(docNo), `ticket numéroté ${docNo}`)
  const s1 = await q('select * from sales')
  ok(s1.length === 1 && s1[0].total_cents === '6300' && s1[0].tax_cents === '1050', 'double appui → 1 seule vente ; total 63,00 €, TVA 10,50 € calculés par le serveur')
  const pays = await q('select method_kind, amount_cents, change_cents, external_ref from sale_payments order by amount_cents')
  ok(pays.length === 2 && pays[0].method_kind === 'cash' && pays[0].change_cents === '3000' && pays[1].external_ref === 'AUT-4821', 'paiements mixtes enregistrés (espèces 20 € + rendu 30 €, carte 43 €)')
  await shot(p, 'v05-4-recu')
  const pdf1 = await download(p, () => p.click('[data-testid=pdf-receipt]'))
  ok(pdf1.name === `${docNo}.pdf`, `reçu PDF généré (${pdf1.name})`)
  await p.click('[data-testid=invoice-open]')
  await p.fill('#ibName', 'Société Fictive SAS')
  await p.fill('#ibVat', 'FR00999999999')
  await p.click('[data-testid=invoice-issue]')
  const pdf2 = await download(p, () => p.click('[data-testid=pdf-invoice]'))
  ok(/^F-\d{4}-000001\.pdf$/.test(pdf2.name), `facture nominative émise et PDF généré (${pdf2.name})`)
  await p.click('[data-testid=new-sale]')

  // Acompte pour Léa puis imputation
  await p.click('[data-testid=mode-deposit]')
  await pickClient(p, 'Léa', 'Léa Bernard')
  await p.fill('#depAmount', '15')
  await p.click('[data-testid=pay]')
  await p.click('[data-testid=methods] button:has-text("Carte")')
  await p.click('[data-testid=confirm-payment]')
  await p.waitForSelector('[data-testid=receipt]')
  ok(/^D-\d{4}-000001$/.test(await p.innerText('[data-testid=document-no]')), 'acompte encaissé (série D)')
  await p.click('[data-testid=new-sale]')
  await p.click('button[aria-pressed]:has-text("Vente")')

  // Encaissement depuis le rendez-vous du jour (planning → Encaisser), avec acompte imputé
  const appt = (await q("select id from appointments where status = 'booked' limit 1"))[0]
  await p.goto(`${APP}/caisse?rdv=${appt.id}`)
  await p.waitForSelector('text=Vente préremplie depuis le rendez-vous.')
  await p.waitForSelector('[data-testid=cart] >> text=Coupe femme')
  await p.waitForSelector('text=Utiliser l\'acompte')
  await p.check('input[type=checkbox] >> nth=0')
  ok((await p.innerText('[data-testid=cart-total]')).includes('30,00'), 'rendez-vous prérempli (Coupe femme 45 €) − acompte 15 € = 30,00 €')
  await shot(p, 'v05-5-rdv-acompte')
  await p.click('[data-testid=pay]')
  await p.click('[data-testid=methods] button:has-text("Carte")')
  await p.click('[data-testid=confirm-payment]')
  await p.waitForSelector('[data-testid=receipt]')
  ok((await q('select status from appointments where id = $1', [appt.id]))[0].status === 'completed', 'rendez-vous marqué « réalisé » ; vente liée au rendez-vous et au client')
  ok((await q('select count(*)::int as n from deposit_applications'))[0].n === 1, 'acompte imputé une seule fois')
  await p.click('[data-testid=new-sale]')
  await A.ctx.close()

  // ===================== Collaboratrice (carol) + responsable (erin) : remise avec code d'approbation
  const C = await login(b, 'carol')
  const c = C.page
  await c.goto(`${APP}/caisse`)
  await c.waitForSelector('[data-testid=catalog]')
  await c.click('[data-testid=catalog] button:has-text("Brushing")')
  await c.click('[data-testid=discount-button]')
  await c.click('button:has-text("30 %")')
  await c.fill('#dReason', 'Geste commercial')
  await c.waitForSelector('#dCode')
  ok(true, 'collaborateur : au-delà de 10 %, le code d\'un responsable est exigé')
  await shot(c, 'v05-6-remise-code')
  const E = await login(b, 'erin')
  const e = E.page
  await e.goto(`${APP}/caisse`)
  await e.click('[data-testid=approval-code]')
  await e.click('button:has-text("Générer le code")')
  const code = (await e.innerText('[data-testid=approval-value]')).trim()
  ok(/^\d{8}$/.test(code), 'responsable : code d\'approbation à usage unique généré')
  await shot(e, 'v05-7-code-responsable')
  await c.fill('#dCode', code)
  await c.click('[data-testid=apply-discount]')
  ok((await c.innerText('[data-testid=cart-total]')).includes('19,60'), 'remise 30 % appliquée : 28,00 → 19,60 €')
  await c.click('[data-testid=pay]')
  await c.click('[data-testid=methods] button:has-text("Espèces")')
  await c.click('[data-testid=confirm-payment]')
  await c.waitForSelector('[data-testid=receipt]')
  const disc = (await q("select discount_cents, discount_approved_by is not null as appr from sales where discount_cents > 0"))[0]
  ok(disc && disc.discount_cents === '840' && disc.appr, 'remise tracée en base (8,40 €, approbateur enregistré)')
  await c.click('[data-testid=new-sale]')
  await c.goto(`${APP}/caisse/tickets`)
  await c.waitForSelector('[data-testid=ticket-list] li')
  ok(await c.locator('[data-testid=ticket-list] li').count() === 1, 'D6 : la collaboratrice ne voit que sa propre vente (RLS)')
  await c.click('[data-testid=ticket-list] li button')
  await c.waitForSelector('[data-testid=ticket-detail]')
  ok(await c.locator('[data-testid=refund-open]').count() === 0, 'D6 : pas de remboursement pour un collaborateur')
  await C.ctx.close()

  // ===================== Responsable (erin) : avoir, mouvement, clôture Z
  await e.goto(`${APP}/caisse/tickets`)
  await e.waitForSelector('[data-testid=ticket-list] li')
  ok(await e.locator('[data-testid=ticket-list] li').count() === 4, 'responsable : toutes les pièces du jour (4)')
  await e.click(`[data-testid=ticket-list] li button:has-text("${docNo}")`)
  await e.click('[data-testid=refund-open]')
  await e.selectOption('select[aria-label="Quantité à rembourser pour Coupe femme"]', '0')
  await e.fill('#rfReason', 'Produit défectueux')
  await e.selectOption('#rfMethod', { label: 'Espèces' })
  await shot(e, 'v05-8-avoir')
  await e.click('[data-testid=refund-confirm]')
  await e.waitForSelector('[data-testid=refund-done]')
  const cn = (await q("select document_no, total_cents from sales where kind = 'credit_note'"))[0]
  ok(cn && /^A-\d{4}-000001$/.test(cn.document_no) && cn.total_cents === '-1800', `avoir ${cn?.document_no} de −18,00 € (produit seul)`)
  await e.click('[data-testid=refund-done] button')

  await e.goto(`${APP}/caisse/cloture`)
  await e.click('button:has-text("Sortie d\'espèces")')
  await e.fill('#mvAmount', '5')
  await e.fill('#mvReason', 'Achat café')
  await e.click('[role=dialog] button:has-text("Enregistrer")')
  // Attendu : 50 (fond) + 20 (vente 1) + 19,60 (vente carol) − 18 (avoir) − 5 (sortie) = 66,60 €
  await e.click('button[aria-label^="Ajouter 50,00"]')
  await e.click('button[aria-label^="Ajouter 10,00"]')
  await e.click('button[aria-label^="Ajouter 5,00"]')
  await e.click('button[aria-label^="Ajouter 1,00"]')
  await e.click('button[aria-label^="Ajouter 0,50"]')
  await e.click('[data-testid=close-register]')
  await e.waitForSelector('[data-testid=z-reason]')
  ok(true, 'écart de caisse : justification exigée par le serveur')
  await e.fill('[data-testid=z-reason]', 'Pièce de 10 centimes égarée')
  await e.click('[data-testid=close-register]')
  await e.waitForSelector('[data-testid=z-result]')
  ok((await e.innerText('[data-testid=z-difference]')).includes('0,10'), 'ticket Z : attendu 66,60 €, compté 66,50 €, écart −0,10 €')
  await shot(e, 'v05-9-ticket-z')
  const z = await download(e, () => e.click('[data-testid=z-result] [data-testid=pdf-closure]'))
  ok(/^Z-\d{4}-000001\.pdf$/.test(z.name), `ticket Z PDF (${z.name})`)
  await E.ctx.close()

  // ===================== Propriétaire : rapports, exports, intégrité, réglages, langue
  const A2 = await login(b, 'alice')
  p = A2.page
  await p.goto(`${APP}/caisse/rapports`)
  await p.waitForSelector('[data-testid=report]')
  const rep = await p.innerText('[data-testid=report]')
  ok(rep.includes('109,60'), 'rapport du jour : CA TTC 109,60 € (63 + 15 + 30 + 19,60 − 18)')
  await shot(p, 'v05-10-rapports')
  const csv = await download(p, () => p.click('[data-testid=export-csv]'))
  const csvText = require('fs').readFileSync(csv.path, 'utf8')
  ok(csvText.split('\r\n').filter(Boolean).length === 6 && !csvText.includes('Bernard'), 'export CSV : 5 pièces, aucune donnée personnelle')
  const fec = await download(p, () => p.click('[data-testid=export-fec]'))
  const lines = require('fs').readFileSync(fec.path, 'utf8').split('\r\n').filter(Boolean).slice(1).map((l) => l.split('|'))
  const sum = (i) => lines.reduce((s, l) => s + Number(l[i].replace(',', '.')), 0)
  ok(/^000000000FEC\d{8}\.txt$/.test(fec.name) && Math.abs(sum(11) - sum(12)) < 0.001, `FEC (${fec.name}) : écritures équilibrées, débit = crédit = ${sum(11).toFixed(2)}`)
  await p.click('[data-testid=verify-integrity]')
  await p.waitForSelector('text=Intégrité vérifiée')
  ok(true, 'contrôle d\'intégrité : chaîne SHA-256 des pièces, clôtures et journal intacte')
  await p.goto(`${APP}/caisse/reglages`)
  await p.click('[data-testid=product-new]')
  await p.fill('#pName', 'Masque nutrition')
  await p.fill('#pPrice', '24,90')
  await p.click('[data-testid=product-save]')
  await p.waitForSelector('text=Masque nutrition')
  ok((await q("select price_cents from products where name = 'Masque nutrition'"))[0]?.price_cents === '2490', 'réglages : produit créé (24,90 € TTC)')
  await shot(p, 'v05-11-reglages')
  await p.selectOption('header select', 'de')
  await p.goto(`${APP}/caisse`)
  await p.waitForSelector('text=Kasse öffnen')
  ok(true, 'caisse traduite en allemand')
  await shot(p, 'v05-12-de')
  await p.selectOption('header select', 'fr')
  await A2.ctx.close()

  const tamper = await q("select count(*)::int as n from sales where hash is null")
  ok(tamper[0].n === 0, 'toutes les pièces sont scellées (empreinte)')
  ok(!relay.log.some((l) => l[0] === 'error' && !/discount_approval|difference_reason|card_number/.test(l[3] || '')), 'aucune erreur serveur inattendue ' + JSON.stringify(relay.log.filter((l) => l[0] === 'error').slice(0, 3)))
  ok(errs.length === 0, 'aucune erreur JavaScript ' + JSON.stringify(errs))
  await b.close()
  await relay.pool.end()
})().catch(async (e) => {
  console.log('FAIL', e.message.split('\n')[0])
  try {
    console.log('URL', cur.url())
    console.log('PAGE', (await cur.locator('body').innerText()).slice(0, 700).replace(/\n/g, ' | '))
    console.log('ERREURS', JSON.stringify(relay.log.filter((l) => l[0] === 'error').slice(-3)))
    await cur.screenshot({ path: `${OUT}/v05-echec.png` })
  } catch {}
  process.exit(1)
})
