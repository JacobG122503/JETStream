import { useState } from 'react'
import type { ExpenseCategory } from '../../../shared/work'
import { callApi } from '../../api'
import { useLoad } from '../../auth/useLoad'
import { Badge, Button, Menu, Table, useToast } from '../../ui'
import { FormDialog } from '../../work/FormDialog'
import { formatMoney, getFormats } from '../../work/format'
import { useActions } from '../../work/useActions'
import { SettingsLayout } from './SettingsLayout'

interface Categories {
  categories: ExpenseCategory[]
}

export function CategoriesPage() {
  const { status, data, error, reload, setData } = useLoad<Categories>('expense-categories')
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null)
  const { run } = useActions()
  const toast = useToast()
  const { currency } = getFormats()
  return (
    <SettingsLayout
      title="Expense categories"
      current="/settings/categories"
      actions={
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>
          New category
        </Button>
      }
    >
      <Table
        caption="Expense categories"
        hideCaption
        status={status}
        error={error}
        onRetry={reload}
        rows={data?.categories ?? []}
        rowKey={({ id }) => String(id)}
        rowLabel={({ name }) => name}
        columns={[
          { id: 'name', header: 'Category', cell: ({ name, archived }) => <span className="badges"><span className="strong">{name}</span> {archived && <Badge>Archived</Badge>}</span>, sortValue: ({ name }) => name },
          { id: 'unit', header: 'Price', cell: ({ unitName, unitPrice }) => (unitName === null || unitPrice === null ? <span className="muted">Any amount</span> : `${formatMoney(Math.round(unitPrice / 10) / 100, currency)} for each ${unitName}`) },
        ]}
        rowActions={(row) => (
          <Menu
            label={`Actions for ${row.name}`}
            iconOnly
            size="small"
            align="end"
            items={[
              { id: 'edit', label: 'Edit', icon: 'edit', onSelect: () => setEditing(row) },
              { id: 'archive', label: row.archived ? 'Restore' : 'Archive', onSelect: () => void run('POST', `expense-categories/${row.id}/archive`, { archive: !row.archived }, row.archived ? 'Restored' : 'Archived', setData) },
            ]}
          />
        )}
        empty={{ icon: 'expenses', title: 'No categories', description: 'People need a category to enter an expense.' }}
      />
      {editing && (
        <FormDialog
          title={editing === 'new' ? 'New category' : 'Edit category'}
          submitLabel="Save category"
          initial={editing === 'new' ? {} : { name: editing.name, unitName: editing.unitName, price: editing.unitPrice === null ? null : String(editing.unitPrice / 100_000) }}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'unitName', label: 'Unit', type: 'text', placeholder: 'mile', hint: 'For expenses entered as a number of units, such as miles. Empty for any amount.', half: true },
            { name: 'price', label: `Price of a unit (${currency})`, type: 'text', placeholder: '0.655', half: true, show: ({ unitName }) => unitName !== '' },
          ]}
          onClose={() => setEditing(null)}
          onReload={reload}
          onSubmit={async (values) => {
            const { name, unitName, price } = values as unknown as { name: string; unitName: string; price: string }
            const unitPrice = unitName !== '' && /^\d{1,6}(\.\d{1,5})?$/.test(price) ? Math.round(Number(price) * 100_000) : null
            const body = { name, unitName: unitName || null, unitPrice, version: editing === 'new' ? null : editing.version }
            setData(editing === 'new' ? await callApi<Categories>('POST', 'expense-categories', body) : await callApi<Categories>('PUT', `expense-categories/${editing.id}`, body))
            setEditing(null)
            toast.success('Category saved')
          }}
        />
      )}
    </SettingsLayout>
  )
}
