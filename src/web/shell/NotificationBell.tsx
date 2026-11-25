import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { NotificationList } from '../../shared/notifications'
import { callApi } from '../api'
import { Menu } from '../ui'

const everyMs = 60_000
const shown = 8

/** What is new for the signed-in person. Asked for now and then, and on every page. */
export function NotificationBell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [list, setList] = useState<NotificationList>({ unread: 0, rows: [] })
  useEffect(() => {
    let current = true
    const load = () => {
      callApi<NotificationList>('GET', 'notifications').then(
        (next) => {
          if (current && Array.isArray(next.rows)) setList(next)
        },
        // What is not known is not shown.
        () => undefined,
      )
    }
    load()
    const timer = setInterval(load, everyMs)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [pathname])
  const read = (id: number | null) => {
    callApi<NotificationList>('POST', 'notifications/read', { id }).then(setList, () => undefined)
  }
  const unread = list.rows.filter((row) => !row.read).slice(0, shown)
  return (
    <Menu
      label={list.unread > 0 ? `Notifications, ${list.unread} new` : 'Notifications'}
      icon="bell"
      iconOnly
      variant="quiet"
      align="end"
      className={list.unread > 0 ? 'bell has-news' : 'bell'}
      items={[
        ...unread.map(({ id, title, path }) => ({
          id: String(id),
          label: title,
          onSelect: () => {
            read(id)
            if (path?.startsWith('/')) navigate(path)
          },
        })),
        ...(unread.length > 0 ? [{ id: 'read', label: 'Mark all as read', icon: 'check' as const, onSelect: () => read(null) }] : []),
        { id: 'all', label: unread.length > 0 ? 'See all' : 'Nothing new. See all', onSelect: () => navigate('/notifications') },
      ]}
    />
  )
}
