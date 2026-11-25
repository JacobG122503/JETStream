import { useCan } from '../../auth/authContext'
import { SubNav } from '../../work/SubNav'

export function BillingNav({ current }: { current: string }) {
  const can = useCan()
  return (
    <SubNav
      label="Billing"
      current={current}
      items={[
        { to: '/invoices', label: 'Invoices' },
        { to: '/invoices/recurring', label: 'Recurring' },
        ...(can('payments.manage') ? [{ to: '/invoices/retainers', label: 'Retainers' }] : []),
      ]}
    />
  )
}
