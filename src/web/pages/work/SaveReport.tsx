import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { callApi } from '../../api'
import { Button, useToast } from '../../ui'
import { FormDialog } from '../../work/FormDialog'

/** Keeps the report with what is chosen on it. */
export function SaveReport() {
  const { pathname, search } = useLocation()
  const [naming, setNaming] = useState(false)
  const toast = useToast()
  return (
    <>
      <Button onClick={() => setNaming(true)}>Save report</Button>
      {naming && (
        <FormDialog
          title="Save report"
          submitLabel="Save report"
          size="small"
          intro={<p className="muted">What is chosen here is kept. A current period, such as this week, stays current. You find it under Saved reports.</p>}
          fields={[{ name: 'name', label: 'Name', type: 'text', required: true }]}
          onClose={() => setNaming(false)}
          onSubmit={async (values) => {
            await callApi('POST', 'reports/saved', { ...values, path: `${pathname}${search}` })
            setNaming(false)
            toast.success('Report saved')
          }}
        />
      )}
    </>
  )
}
