import { useState } from 'react'
import type { NewLink } from '../../../shared/api'
import { callApi } from '../../api'
import { ConfirmDialog } from '../../ui'
import { LinkDialog, type ShownLink } from './LinkDialog'

export interface ResetTarget {
  id: number
  name: string
}

interface ResetLinkProps {
  /** Whose link is to be made; null while none is. */
  target: ResetTarget | null
  onClose: () => void
  onMade?: () => void
}

/** Asks, makes a reset link and shows it. */
export function ResetLink({ target, onClose, onMade }: ResetLinkProps) {
  const [link, setLink] = useState<ShownLink | null>(null)
  return (
    <>
      <ConfirmDialog
        open={target !== null}
        onClose={onClose}
        title={`Make a reset link for ${target?.name ?? ''}?`}
        message="A reset link made before stops working. The password stays as it is until the link is used."
        confirmLabel="Make reset link"
        onConfirm={async () => {
          if (!target) return
          const made = await callApi<NewLink>('POST', `people/${target.id}/reset-link`)
          setLink({ ...made, kind: 'reset', name: target.name })
          onMade?.()
        }}
      />
      <LinkDialog link={link} onClose={() => setLink(null)} />
    </>
  )
}
