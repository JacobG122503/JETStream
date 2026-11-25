import { type FormEvent, useState } from 'react'
import type { Account } from '../../../shared/api'
import { callApi } from '../../api'
import { FormMessages } from '../../auth/FormMessages'
import { TimeZoneField } from '../../auth/TimeZoneField'
import { useForm } from '../../auth/useForm'
import { Button, Card, TextField, useToast } from '../../ui'

const fields = ['name', 'timeZone'] as const

interface ProfileCardProps {
  account: Account
  companyTimeZone: string
  onChange: (account: Account) => void
  onReload: () => void
}

export function ProfileCard({ account, companyTimeZone, onChange, onReload }: ProfileCardProps) {
  const toast = useToast()
  const [name, setName] = useState(account.name)
  const [timeZone, setTimeZone] = useState<string | null>(account.timeZone)
  const form = useForm('profile', fields)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        const saved = await callApi<Account>('PUT', 'account/profile', { name, timeZone, version: account.version })
        onChange(saved)
        setName(saved.name)
        toast.success('Profile saved')
      },
      {
        name: name.trim() === '' ? 'Enter your name.' : null,
        timeZone: timeZone === null ? 'Choose a time zone from the list.' : null,
      },
    )
  }

  return (
    <Card title="Profile">
      <form className="stack account-form" noValidate onSubmit={submit}>
        <FormMessages form={form} onReload={onReload} />
        <dl className="facts">
          <dt>Email</dt>
          <dd>{account.email}</dd>
          <dt>Role</dt>
          <dd>{account.role}</dd>
        </dl>
        <TextField label="Name" autoComplete="name" required value={name} onChange={setName} {...form.field('name')} />
        <TimeZoneField companyTimeZone={companyTimeZone} value={timeZone} onChange={setTimeZone} {...form.field('timeZone')} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Saving profile">
            Save profile
          </Button>
        </div>
      </form>
    </Card>
  )
}
