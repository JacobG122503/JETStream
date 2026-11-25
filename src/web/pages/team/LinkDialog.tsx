import type { NewLink } from '../../../shared/api'
import { usePerson } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import { Button, CopyField, Dialog, Notice } from '../../ui'

export interface ShownLink extends NewLink {
  kind: 'invite' | 'reset'
  name: string
}

/** Shows a link once. It cannot be shown again, because the server keeps only a hash. */
export function LinkDialog({ link, onClose }: { link: ShownLink | null; onClose: () => void }) {
  const { timeZone } = usePerson()
  return (
    <Dialog
      open={link !== null}
      onClose={onClose}
      title={link?.kind === 'reset' ? 'Reset link' : 'Invite link'}
      closeOnOutsidePress={false}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {link && (
        <div className="stack">
          <p>
            Give this link to {link.name}. It works once, until {formatInstant(link.expiresAt, timeZone)}, and is shown only now.
          </p>
          <CopyField label={link.kind === 'reset' ? 'Reset link' : 'Invite link'} value={link.link} />
          {link.kind === 'reset' && (
            <Notice tone="warning" title="Make sure who is asking">
              Whoever has the link can set a new password and sign in as {link.name}. Hand it over in person, or call them on a
              number you know.
            </Notice>
          )}
          <p className="field-hint">{link.emailed ? 'It was also sent by email.' : 'Email is not set up, so nothing was sent.'}</p>
        </div>
      )}
    </Dialog>
  )
}
