// Relais de TEST : traduit les appels Supabase (Auth + PostgREST) de l'application en SQL exécuté
// sur la base PostgreSQL LOCALE jetable, SOUS le rôle « authenticated » avec les claims JWT → la RLS,
// les privilèges de colonnes et les fonctions serveur réelles s'appliquent. Aucun service distant.
const { Pool } = require('pg')

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`
const subOf = (auth) => {
  try {
    return JSON.parse(Buffer.from((auth || '').replace('Bearer ', '').split('.')[1], 'base64url').toString()).sub || null
  } catch {
    return null
  }
}
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('identifiant refusé: ' + s)
  return `"${s}"`
}

function createRelay(connectionString) {
  const pool = new Pool({ connectionString, max: 8 })
  const log = []
  const fnCache = new Map()

  async function asUser(sub, fn) {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('set local role authenticated')
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated' })])
      const r = await fn(c)
      await c.query('commit')
      return r
    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }

  async function fnInfo(name) {
    if (fnCache.has(name)) return fnCache.get(name)
    const { rows } = await pool.query(
      `select p.proretset as set, p.pronargs as n, p.proargnames as names, p.proargtypes::regtype[]::text[] as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [name])
    if (!rows[0]) throw Object.assign(new Error(`function public.${name} not found`), { code: 'PGRST202', status: 404 })
    const info = { set: rows[0].set, args: rows[0].names ? rows[0].names.slice(0, rows[0].n).map((a, i) => [a, rows[0].types[i]]) : [] }
    fnCache.set(name, info)
    return info
  }

  function where(params, values) {
    const parts = []
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue
      const col = ident(k)
      const add = (sql, val) => { values.push(val); parts.push(sql.replace('?', `$${values.length}`)) }
      if (v.startsWith('eq.')) add(`${col}::text = ?`, v.slice(3))
      else if (v.startsWith('neq.')) add(`${col}::text <> ?`, v.slice(4))
      else if (v.startsWith('gte.')) add(`${col} >= ?`, v.slice(4))
      else if (v.startsWith('gt.')) add(`${col} > ?`, v.slice(3))
      else if (v.startsWith('lte.')) add(`${col} <= ?`, v.slice(4))
      else if (v.startsWith('lt.')) add(`${col} < ?`, v.slice(3))
      else if (v === 'is.null') parts.push(`${col} is null`)
      else if (v.startsWith('in.(')) add(`${col}::text = any(?)`, v.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')))
      else throw new Error('filtre non pris en charge: ' + k + '=' + v)
    }
    return parts.length ? ' where ' + parts.join(' and ') : ''
  }
  function order(params) {
    const o = params.get('order')
    if (!o) return ''
    return ' order by ' + o.split(',').map((x) => {
      const [c, dir, nulls] = x.split('.')
      return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`
    }).join(', ')
  }
  function columns(sel) {
    if (!sel || sel === '*') return '*'
    return sel.split(',').map((s) => ident(s.trim())).join(', ')
  }

  async function handle(route) {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }
    const json = (body, status = 200, extra = {}) => route.fulfill({ status, contentType: 'application/json', headers: { ...H, ...extra }, body: JSON.stringify(body) })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H })
    const sub = subOf(req.headers().authorization)
    try {
      // --- Auth (test) : connexion par e-mail d'un compte fictif existant dans auth.users
      if (path === '/auth/v1/token') {
        const body = JSON.parse(req.postData() || '{}')
        const { rows } = await pool.query('select id, email from auth.users where email = $1', [body.email])
        if (!rows[0]) return json({ code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400)
        const u = rows[0]
        return json({ access_token: token(u.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'test',
          user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } })
      }
      if (path === '/auth/v1/user') {
        const { rows } = await pool.query('select id, email from auth.users where id = $1', [sub])
        return json({ id: sub, aud: 'authenticated', role: 'authenticated', email: rows[0]?.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
      }
      if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: H })
      if (!path.startsWith('/rest/v1/')) return json({ message: 'non relayé ' + path }, 404)
      if (!sub) return json({ code: '42501', message: 'permission denied' }, 401)

      const single = (req.headers().accept || '').includes('vnd.pgrst.object')
      const prefer = req.headers().prefer || ''

      // --- RPC
      if (path.startsWith('/rest/v1/rpc/')) {
        const name = path.slice('/rest/v1/rpc/'.length)
        const body = JSON.parse(req.postData() || '{}')
        log.push(['rpc', name, body, sub])
        const info = await fnInfo(name)
        const values = []
        const args = info.args.filter(([a]) => a in body).map(([a, type]) => {
          const v = body[a]
          values.push(v === null ? null : type === 'jsonb' || type === 'json' ? JSON.stringify(v) : Array.isArray(v) ? v : String(v))
          return `${ident(a)} => $${values.length}::${type}`
        })
        const call = `public.${ident(name)}(${args.join(', ')})`
        const sql = info.set
          ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from ${call} t`
          : `select to_jsonb(${call}) as v`
        const v = await asUser(sub, (c) => c.query(sql, values).then((r) => r.rows[0].v))
        return json(v)
      }

      // --- Tables
      const table = ident(path.slice('/rest/v1/'.length))
      const values = []
      const sel = url.searchParams.get('select')
      if (req.method() === 'GET') {
        let sql
        if (table === '"memberships"' && sel && sel.includes('company:companies')) {
          sql = `select m.role, to_jsonb(c) as company from public.memberships m left join public.companies c on c.id = m.company_id${where(url.searchParams, values).replace(/"(\w+)"/g, 'm."$1"')}`
        } else {
          sql = `select ${columns(sel)} from public.${table}${where(url.searchParams, values)}${order(url.searchParams)}`
        }
        if (url.searchParams.get('limit')) sql += ` limit ${Number(url.searchParams.get('limit'))}`
        if (url.searchParams.get('offset')) sql += ` offset ${Number(url.searchParams.get('offset'))}`
        const rows = await asUser(sub, (c) => c.query(`select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) as v from (${sql}) q`, values).then((r) => r.rows[0].v))
        if (single) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, 406)
        return json(rows, 200, { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` })
      }
      const body = JSON.parse(req.postData() || 'null')
      log.push([req.method(), path.slice(10), body, sub])
      const returning = prefer.includes('return=representation') ? ` returning ${columns(sel)}` : ''
      let sql
      if (req.method() === 'POST') {
        const rows = [].concat(body)
        const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
        values.push(JSON.stringify(rows))
        const list = cols.map(ident).join(', ')
        sql = `insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)${returning}`
      } else if (req.method() === 'PATCH') {
        const cols = Object.keys(body)
        values.push(JSON.stringify(body))
        const list = cols.map(ident).join(', ')
        sql = `update public.${table} set (${list}) = (select ${list} from jsonb_populate_record(null::public.${table}, $1::jsonb))${where(url.searchParams, values)}${returning}`
      } else if (req.method() === 'DELETE') {
        sql = `delete from public.${table}${where(url.searchParams, values)}${returning}`
      } else return json({ message: 'méthode non relayée' }, 405)
      const rows = await asUser(sub, (c) => c.query(returning ? `with w as (${sql}) select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) as v from w` : sql, values)
        .then((r) => (returning ? r.rows[0].v : null)))
      if (!returning) return route.fulfill({ status: 204, headers: H })
      return single ? json(rows[0] ?? null, 201) : json(rows, 201)
    } catch (e) {
      const status = e.status || (e.code === '42501' ? 403 : e.code === '23505' ? 409 : e.code === '28000' ? 401 : 400)
      log.push(['error', path, e.code, e.message])
      return json({ code: e.code || 'XX000', message: e.message, details: e.detail || null, hint: e.hint || null }, status)
    }
  }
  return { pool, log, attach: (page, base = 'http://localhost:54321') => page.route(`${base}/**`, handle) }
}

module.exports = { createRelay }
