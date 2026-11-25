import { useNavigate } from 'react-router-dom'
import { errorMessage } from '../api'
import { useAuth } from '../auth/authContext'
import { Avatar, Menu, useToast } from '../ui'
import { photoUrl } from './photo'

/** Who is signed in, in the header of the shell. Nothing while nobody is. */
export function AccountMenu() {
  const { info, signOut } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const person = info?.person
  if (!person) return null
  const { name, role, photoId } = person
  return (
    <Menu
      label={`Account: ${name}, ${role.name}`}
      variant="quiet"
      align="end"
      className="account-button"
      content={
        <>
          <Avatar name={name} src={photoUrl(photoId)} size="small" decorative />
          <span className="account-text">
            <span className="sr-only">Account: </span>
            <span className="account-name">{name}</span>
            <span className="sr-only">, </span>
            <span className="account-role">{role.name}</span>
          </span>
        </>
      }
      header={
        <div className="account-header">
          <span className="account-name">{name}</span>
          <span className="account-role">{role.name}</span>
        </div>
      }
      items={[
        { id: 'account', label: 'Account', icon: 'user', onSelect: () => navigate('/account') },
        {
          id: 'sign-out',
          label: 'Sign out',
          icon: 'signOut',
          onSelect: () => void signOut().catch((error: unknown) => toast.error(errorMessage(error))),
        },
      ]}
    />
  )
}
