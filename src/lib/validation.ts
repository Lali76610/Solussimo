export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Aligné sur la politique Supabase Auth (config.toml) : ≥ 10 caractères, minuscule, majuscule, chiffre. */
export function isStrongPassword(password: string): boolean {
  return password.length >= 10 && password.length <= 128 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)
}

export function isValidEmail(email: string): boolean {
  const e = email.trim()
  return e.length <= 254 && EMAIL_RE.test(e)
}

export function isValidDisplayName(name: string): boolean {
  const n = name.trim()
  return n.length >= 1 && n.length <= 80
}
