import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type { Account } from '../../../shared/api'
import { callApi, errorMessage } from '../../api'
import { photoUrl } from '../../shell/AccountMenu'
import { Avatar, Button, Card, ConfirmDialog, Notice, useToast } from '../../ui'
import { PhotoError, photoTypes, shrinkPhoto } from './shrinkPhoto'

interface PhotoCardProps {
  account: Account
  onChange: (account: Account) => void
}

interface Chosen {
  blob: Blob
  url: string
}

export function PhotoCard({ account, onChange }: PhotoCardProps) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (chosen) return () => URL.revokeObjectURL(chosen.url)
  }, [chosen])

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // So that the same file can be chosen again.
    event.target.value = ''
    if (!file) return
    setProblem(null)
    setBusy(true)
    try {
      const blob = await shrinkPhoto(file)
      setChosen({ blob, url: URL.createObjectURL(blob) })
    } catch (error) {
      setChosen(null)
      setProblem(error instanceof PhotoError ? error.message : 'The picture could not be read.')
    }
    setBusy(false)
  }

  const upload = async () => {
    if (!chosen || busy) return
    setBusy(true)
    setProblem(null)
    try {
      onChange(await callApi<Account>('PUT', 'account/photo', chosen.blob))
      setChosen(null)
      toast.success('Photo saved')
      chooseButton.current?.focus()
    } catch (error) {
      setProblem(errorMessage(error))
    }
    setBusy(false)
  }

  return (
    <Card title="Photo">
      <div className="stack">
        {problem !== null && (
          <Notice tone="danger" announce="alert">
            {problem}
          </Notice>
        )}
        <div className="photo-row">
          {chosen ? (
            <img className="photo-preview" src={chosen.url} alt="Your new photo, as it will be shown" />
          ) : (
            <Avatar name={account.name} src={photoUrl(account.photoId)} size="large" />
          )}
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            accept={photoTypes.join(',')}
            onChange={(event) => void choose(event)}
          />
          <div className="form-actions">
            {chosen && (
              <>
                <Button variant="primary" loading={busy} loadingLabel="Saving photo" onClick={() => void upload()}>
                  Save photo
                </Button>
                <Button
                  onClick={() => {
                    setChosen(null)
                    chooseButton.current?.focus()
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
            <Button ref={chooseButton} onClick={() => input.current?.click()} aria-disabled={busy || undefined}>
              {chosen ? 'Choose another' : 'Choose a photo'}
            </Button>
            {!chosen && account.photoId !== null && (
              <Button icon="trash" onClick={() => setRemoving(true)}>
                Remove photo
              </Button>
            )}
          </div>
        </div>
        <p className="field-hint">PNG, JPEG or WebP up to 10 MB. The middle square is used, and nothing else of the file.</p>
      </div>
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Remove your photo?"
        message="Your initials are shown in its place."
        confirmLabel="Remove photo"
        destructive
        fallbackFocusRef={chooseButton}
        onConfirm={async () => onChange(await callApi<Account>('DELETE', 'account/photo'))}
      />
    </Card>
  )
}
