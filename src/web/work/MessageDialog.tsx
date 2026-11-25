import { type FormEvent, useId, useState } from 'react'
import type { MessageInput, Recipient } from '../../shared/billing'
import { useAuth } from '../auth/authContext'
import { FormMessages } from '../auth/FormMessages'
import { useForm } from '../auth/useForm'
import { useLoad } from '../auth/useLoad'
import { Button, Dialog, ErrorState, LoadingState, Notice, TextArea, TextField } from '../ui'

interface MessageDialogProps {
  title: string
  submitLabel: string
  kind: MessageInput['kind']
  /** Where the suggested message comes from. */
  route: string
  contacts: Recipient[]
  onClose: () => void
  onSend: (message: MessageInput) => Promise<void>
}

const fields = ['recipients', 'subject', 'body'] as const

const toText = (recipients: Recipient[]) => recipients.map(({ email }) => email).join(', ')

/** A message to a client, with what it could say. */
export function MessageDialog({ title, submitLabel, kind, route, contacts, onClose, onSend }: MessageDialogProps) {
  const { status, data, error, reload } = useLoad<Omit<MessageInput, 'kind'>>(route)
  return (
    <>
      {data ? (
        <MessageForm title={title} submitLabel={submitLabel} kind={kind} initial={data} contacts={contacts} onClose={onClose} onSend={onSend} />
      ) : (
        <Dialog open onClose={onClose} title={title} footer={<Button onClick={onClose}>Cancel</Button>}>
          {status === 'loading' && <LoadingState label="Preparing the message" />}
          {status === 'error' && <ErrorState message={error} onRetry={reload} />}
        </Dialog>
      )}
    </>
  )
}

function MessageForm({ title, submitLabel, kind, initial, contacts, onClose, onSend }: Omit<MessageDialogProps, 'route'> & { initial: Omit<MessageInput, 'kind'> }) {
  const { info } = useAuth()
  const formId = useId()
  const form = useForm('message', fields)
  const [recipients, setRecipients] = useState(toText(initial.recipients))
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const emails = recipients.split(/[\s,;]+/).filter(Boolean)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      () => onSend({ kind, subject, body, recipients: emails.map((email) => ({ email, name: contacts.find((contact) => contact.email === email)?.name ?? '' })) }),
      {
        recipients: emails.length === 0 ? 'Enter at least one email address.' : emails.some((email) => !/^[^@\s]+@[^@\s]+$/.test(email)) ? 'Enter email addresses, separated by commas.' : null,
        subject: subject.trim() === '' ? 'Enter a subject.' : null,
      },
    )
  }
  const delivers = info?.emailDelivers === true
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      closeOnOutsidePress={false}
      busy={form.busy}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" icon="send" loading={form.busy} loadingLabel="Sending">
            {delivers ? submitLabel : 'Keep in the Outbox'}
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        {!delivers && <Notice tone="warning">No email service is set up, so nothing is sent: the message is only kept in the Outbox. Print the document, or copy its client link, and send it yourself.</Notice>}
        <TextField label="To" required hint="Email addresses, separated by commas." value={recipients} onChange={setRecipients} {...form.field('recipients')} />
        <TextField label="Subject" required value={subject} onChange={setSubject} {...form.field('subject')} />
        <TextArea label="Message" rows={9} hint="{link} becomes the link for the client." value={body} onChange={setBody} {...form.field('body')} />
      </form>
    </Dialog>
  )
}
