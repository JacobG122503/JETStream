import { describePermission, grantedKeys, type Grants } from '../../../shared/permissions'

/** Permissions that someone gains or loses, in words. */
export function Changes({ title, grants }: { title: string; grants: Grants }) {
  const keys = grantedKeys(grants)
  if (keys.length === 0) return null
  return (
    <>
      <p>{title}:</p>
      <ul className="confirm-list">
        {keys.map((key) => (
          <li key={key}>{describePermission(key, grants[key] ?? 'managed')}</li>
        ))}
      </ul>
    </>
  )
}
