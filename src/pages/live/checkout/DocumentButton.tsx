import { FileDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { authErrorKey } from '../../../lib/authErrors'
import { buildDocumentPdf, shareOrOpen, type DocKind } from './documents'

/** Bouton « PDF » : génère, puis partage (iPhone) ou télécharge la pièce. */
export function DocumentButton({ kind, id, label, primary, onError }: { kind: DocKind; id: string; label: string; primary?: boolean; onError: (msg: string) => void }) {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const { blob, name } = await buildDocumentPdf(kind, id, t, i18n.resolvedLanguage ?? 'fr')
      await shareOrOpen(blob, name)
    } catch (e) {
      onError(t(authErrorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={() => void run()} disabled={busy} className={`${primary ? 'btn-primary' : 'btn-secondary'} w-full`} data-testid={`pdf-${kind}`}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileDown className="size-4" aria-hidden="true" />}
      {label}
    </button>
  )
}
