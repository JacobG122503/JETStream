import { useCan } from '../../auth/authContext'
import { SubNav } from '../../work/SubNav'

export function ReportsNav({ current }: { current: string }) {
  const can = useCan()
  return (
    <div className="no-print">
      <SubNav
        label="Reports"
        current={current}
        items={[
          { to: '/reports', label: 'Time' },
          { to: '/reports/detailed', label: 'Detailed time' },
          { to: '/reports/expenses', label: 'Expenses' },
          { to: '/reports/budgets', label: 'Project budgets' },
          ...(can('invoices.manage')
            ? [
                { to: '/reports/uninvoiced', label: 'Uninvoiced' },
                { to: '/reports/invoices', label: 'Invoices' },
                { to: '/reports/payments', label: 'Payments' },
              ]
            : []),
        ]}
      />
    </div>
  )
}
