import { useState } from 'react'
import { Button, Dialog, Notice, TextField } from '../ui'

/** Shows a link that was just made, once. */
export function LinkDialog({ link, onClose }: { link: string; onClose: () => void }) {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no')
  return (
    <Dialog
      open
      onClose={onClose}
      title="Link for the client"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            icon="copy"
            onClick={() => {
              navigator.clipboard.writeText(link).then(() => setCopied('yes'), () => setCopied('failed'))
            }}
          >
            Copy link
          </Button>
        </>
      }
    >
      <div className="stack">
        <Notice>Whoever has this link can see the document without an account. It is shown only now; you can make another, or revoke all.</Notice>
        <TextField label="Link" value={link} readOnly onChange={() => undefined} />
        <p role="status" className="muted">
          {copied === 'yes' ? 'Copied.' : copied === 'failed' ? 'It could not be copied. Select it and copy it yourself.' : ''}
        </p>
      </div>
    </Dialog>
  )
}
