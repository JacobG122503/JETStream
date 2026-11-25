import { useState } from 'react'
import { callApi, errorMessage } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Button, ErrorState, LoadingState, useToast } from '../../ui'
import { downloadCsv } from '../../work/csv'
import { SettingsLayout } from './SettingsLayout'

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function ExportPage() {
  const { status, data, error, reload } = useLoad<{ tables: string[] }>('export')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const save = async (name: string) => {
    setBusy(name)
    try {
      const { rows } = await callApi<{ rows: (string | number)[][] }>('GET', `export/${encodeURIComponent(name)}`)
      downloadCsv(name, rows)
    } catch (reason) {
      toast.error(errorMessage(reason))
    }
    setBusy(null)
  }
  return (
    <SettingsLayout title="Export" current="/settings/export">
      <p className="muted">Everything as CSV files, which Excel opens. These are no backup: whoever runs the server makes that, as the README says.</p>
      {status === 'loading' && <LoadingState look="skeleton" label="Loading" />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <ul className="payments">
          {data.tables.map((name) => (
            <li key={name}>
              <span className="strong">{capital(name)}</span>
              <Button size="small" loading={busy === name} loadingLabel="Exporting" aria-label={`Download ${name}`} onClick={() => void save(name)}>
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsLayout>
  )
}
