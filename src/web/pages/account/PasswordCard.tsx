import { type FormEvent, useState } from 'react'
import type { SessionInfo } from '../../../shared/api'
import { callApi } from '../../api'
import { useAuth } from '../../auth/authContext'
import { FormMessages } from '../../auth/FormMessages'
import { NewPasswordField } from '../../auth/NewPassword'
import { useForm } from '../../auth/useForm'
import { Button, Card, PasswordField, useToast } from '../../ui'

const fields = ['currentPassword', 'newPassword'] as const

export function PasswordCard({ email, onChanged }: { email: string; onChanged: () => void }) {
  const { accept } = useAuth()
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const form = useForm('password', fields)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void form.submit(
      async () => {
        accept(await callApi<SessionInfo>('POST', 'account/password', { currentPassword, newPassword }))
        setCurrentPassword('')
        setNewPassword('')
        toast.success('Password changed. All other devices were signed out.')
        onChanged()
      },
      {
        currentPassword: currentPassword === '' ? 'Enter your current password.' : null,
        newPassword: newPassword === '' ? 'Choose a new password.' : null,
      },
    )
  }

  return (
    <Card title="Password">
      <form className="stack account-form" noValidate onSubmit={submit}>
        <FormMessages form={form} />
        {/* Tells password managers whose password it is. */}
        <input type="email" className="sr-only" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" />
        <PasswordField
          label="Current password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={setCurrentPassword}
          {...form.field('currentPassword')}
        />
        <NewPasswordField label="New password" value={newPassword} onChange={setNewPassword} {...form.field('newPassword')} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.busy} loadingLabel="Changing password">
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}
