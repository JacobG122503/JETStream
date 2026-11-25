import { useState } from 'react'
import type { SignedInDevice } from '../../../shared/api'
import { callApi } from '../../api'
import { useAuth, usePerson } from '../../auth/authContext'
import { formatInstant } from '../../auth/timeZones'
import { useLoad } from '../../auth/useLoad'
import { Badge, Button, Card, ConfirmDialog, Table, type TableColumn, useToast } from '../../ui'

type Devices = { sessions: SignedInDevice[] }

const deviceName = ({ browser, system }: SignedInDevice) => `${browser} on ${system}`

export function DevicesCard() {
  const { timeZone } = usePerson()
  const { signOut } = useAuth()
  const toast = useToast()
  const { status, data, error, reload, setData } = useLoad<Devices>('account/sessions')
  const [ending, setEnding] = useState<SignedInDevice | 'others' | null>(null)
  const devices = data?.sessions ?? []

  const columns: TableColumn<SignedInDevice>[] = [
    {
      id: 'device',
      header: 'Device',
      cell: (device) => (
        <span className="device">
          {deviceName(device)}
          {device.current && <Badge tone="success">This device</Badge>}
        </span>
      ),
      sortValue: deviceName,
    },
    { id: 'signedIn', header: 'Signed in', cell: (device) => formatInstant(device.signedInAt, timeZone), sortValue: (device) => device.signedInAt },
    { id: 'lastUsed', header: 'Last used', cell: (device) => formatInstant(device.lastUsedAt, timeZone), sortValue: (device) => device.lastUsedAt },
  ]

  const end = async () => {
    if (ending === 'others') {
      setData(await callApi<Devices>('POST', 'account/sessions/end-others'))
      toast.success('All other devices were signed out')
    } else if (ending?.current) {
      await signOut()
    } else if (ending) {
      setData(await callApi<Devices>('DELETE', `account/sessions/${ending.id}`))
      toast.success(`${deviceName(ending)} was signed out`)
    }
  }

  return (
    <Card
      title="Where you are signed in"
      actions={
        devices.length > 1 && <Button onClick={() => setEnding('others')}>Sign out everywhere else</Button>
      }
    >
      <Table
        caption="Devices that are signed in"
        hideCaption
        columns={columns}
        rows={devices}
        rowKey={({ id }) => String(id)}
        rowLabel={deviceName}
        status={status}
        error={error}
        onRetry={reload}
        rowActions={(device) => (
          <Button size="small" onClick={() => setEnding(device)} aria-label={`Sign out ${deviceName(device)}${device.current ? ' (this device)' : ''}`}>
            Sign out
          </Button>
        )}
      />
      <p className="field-hint">Times are in {timeZone.replaceAll('_', ' ')}.</p>
      <ConfirmDialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={ending === 'others' ? 'Sign out everywhere else?' : ending?.current ? 'Sign out here?' : 'Sign out this device?'}
        message={
          ending === 'others'
            ? 'All devices but this one have to sign in again.'
            : ending && `${deviceName(ending)} has to sign in again.`
        }
        confirmLabel={ending === 'others' ? 'Sign out everywhere else' : 'Sign out'}
        onConfirm={end}
      />
    </Card>
  )
}
