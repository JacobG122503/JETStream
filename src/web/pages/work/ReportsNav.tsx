import { useNavigate } from 'react-router-dom'
import { useCan } from '../../auth/authContext'
import { Menu } from '../../ui'
import { SubNav } from '../../work/SubNav'

const useReports = () => {
  const can = useCan()
  const invoices = can('invoices.manage')
  return {
    tabs: [
      { to: '/reports', label: 'Time', shown: true },
      { to: '/reports/profitability', label: 'Profitability', shown: can('cost.view') && can('billable.view') && can('time.view') },
      { to: '/reports/activity', label: 'Activity log', shown: can('activity.view') },
      { to: '/reports/contractors', label: 'Contractor', shown: can('time.view') },
      { to: '/reports/invoices', label: 'Invoicing', shown: invoices },
      { to: '/reports/saved', label: 'Saved reports', shown: true },
    ].filter(({ shown }) => shown),
    reports: [
      { to: '/reports/detailed', label: 'Detailed time report', shown: true },
      { to: '/reports/expenses', label: 'Detailed expense report', shown: true },
      { to: '/reports/budgets', label: 'Project budgets', shown: true },
      { to: '/reports/uninvoiced', label: 'Uninvoiced', shown: invoices },
      { to: '/reports/invoices', label: 'Invoices', shown: invoices },
      { to: '/reports/payments', label: 'Payments', shown: invoices },
    ].filter(({ shown }) => shown),
  }
}

export function ReportsNav({ current }: { current: string }) {
  return (
    <div className="no-print">
      <SubNav label="Reports" current={current} items={useReports().tabs} />
    </div>
  )
}

/** Leads to the reports that are not tabs. */
export function NewReportMenu({ label = 'New report', current }: { label?: string; current?: string }) {
  const navigate = useNavigate()
  const { reports } = useReports()
  return (
    <Menu
      label={label}
      align="end"
      {...(current === undefined && { variant: 'primary' as const, icon: 'plus' as const })}
      items={reports.map(({ to, label: name }) => ({ id: to, label: name, ...(current !== undefined && { checked: to === current }), onSelect: () => navigate(to) }))}
    />
  )
}
