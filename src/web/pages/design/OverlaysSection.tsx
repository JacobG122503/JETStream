import { useRef, useState } from 'react'
import { Button, Combobox, ConfirmDialog, DatePicker, Dialog, Icon, IconButton, Menu, TextField, Tooltip, useToast } from '../../ui'
import { Example, Section } from './Section'
import { projectOptions } from './sampleData'

type OpenDialog = 'simple' | 'long' | 'form' | 'delete' | 'fails' | 'publish' | 'last'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function OverlaysSection() {
  const toast = useToast()
  const [open, setOpen] = useState<OpenDialog | null>(null)
  const [openerShown, setOpenerShown] = useState(true)
  const [name, setName] = useState('')
  const [project, setProject] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const restore = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const close = () => setOpen(null)

  return (
    <Section id="overlays" title="Dialogs, menus and tooltips">
      <Example title="Dialogs">
        <Button onClick={() => setOpen('simple')}>Open a dialog</Button>
        <Button onClick={() => setOpen('long')}>Open a long dialog</Button>
        <Button onClick={() => setOpen('form')}>Open a form dialog</Button>
        {openerShown && <Button onClick={() => setOpen('last')}>Open, then remove this button</Button>}
        <Button ref={restore} variant="quiet" onClick={() => setOpenerShown(true)}>
          Bring the button back
        </Button>
      </Example>
      <Example title="Confirmation">
        <Button variant="destructive" onClick={() => setOpen('delete')}>
          Delete a sample
        </Button>
        <Button onClick={() => setOpen('fails')}>Delete a sample that fails</Button>
        <Button onClick={() => setOpen('publish')}>Confirm something harmless</Button>
      </Example>
      <Example title="Menus">
        <Menu
          label="Sample actions"
          items={[
            { id: 'edit', label: 'Edit', icon: 'edit', onSelect: () => toast.info('Edit was chosen. This is a sample.') },
            { id: 'copy', label: 'Duplicate', icon: 'copy', onSelect: () => toast.info('Duplicate was chosen. This is a sample.') },
            { id: 'archive', label: 'Archive', icon: 'inbox', disabled: true, onSelect: () => undefined },
            { id: 'delete', label: 'Delete', icon: 'trash', destructive: true, onSelect: () => setOpen('delete') },
          ]}
        />
        <div className="gallery-end">
          <Menu
            iconOnly
            align="end"
            label="Actions at the edge"
            items={[
              { id: 'one', label: 'Stays inside the window', onSelect: () => undefined },
              { id: 'two', label: 'Wherever its button is', onSelect: () => undefined },
            ]}
          />
        </div>
      </Example>
      <Example title="Tooltip" note="On hover and focus. Escape hides it.">
        <Tooltip text="Hours that are invoiced to the client">
          <IconButton icon="info" label="Billable hours" />
        </Tooltip>
        <Tooltip text="Nothing is saved in the gallery">
          <Button>Button with a tooltip</Button>
        </Tooltip>
      </Example>

      <Dialog
        open={open === 'simple'}
        onClose={close}
        title="Sample dialog"
        footer={
          <>
            <Button onClick={() => toast.success('Raised from a dialog')}>Raise a toast</Button>
            <Button onClick={() => toast.error('This one stays until it is dismissed')}>Raise an error</Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        }
      >
        <p>Press Escape, the close button or outside the dialog to close it. Toasts stay usable above it.</p>
      </Dialog>

      <Dialog
        open={open === 'long'}
        onClose={close}
        title="Sample dialog with more text than fits on a small screen"
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={close}>
              Accept the sample terms
            </Button>
          </>
        }
      >
        {Array.from({ length: 14 }, (_, index) => (
          <p key={index} className="gallery-paragraph">
            Sample paragraph {index + 1}. It is here so that the content scrolls inside the dialog while the buttons stay in view.
          </p>
        ))}
      </Dialog>

      <Dialog
        open={open === 'form'}
        onClose={close}
        title="Sample form dialog"
        closeOnOutsidePress={false}
        initialFocusRef={nameInput}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" form="dialog-form">
              Save sample
            </Button>
          </>
        }
      >
        <form
          id="dialog-form"
          className="gallery-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            close()
            toast.success('This is a sample, so nothing was saved')
          }}
        >
          <TextField ref={nameInput} label="Sample name" value={name} onChange={setName} autoComplete="off" />
          <Combobox label="Sample project" options={projectOptions} value={project} onChange={setProject} />
          <DatePicker label="Sample start" value={date} onChange={setDate} />
        </form>
      </Dialog>

      <Dialog
        open={open === 'last'}
        onClose={close}
        title="Dialog whose button goes away"
        fallbackFocusRef={restore}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setOpenerShown(false)
              close()
            }}
          >
            Remove the button and close
          </Button>
        }
      >
        <p>Focus then goes to a sensible place instead of being lost.</p>
      </Dialog>

      <ConfirmDialog
        open={open === 'delete'}
        onClose={close}
        title="Delete this sample?"
        message="This is a sample, so nothing is deleted. The action takes a second."
        confirmLabel="Delete sample"
        destructive
        onConfirm={async () => {
          await wait(1000)
          toast.success('The sample action ran')
        }}
      />
      <ConfirmDialog
        open={open === 'fails'}
        onClose={close}
        title="Delete this sample?"
        message="This action always fails, to show what happens then."
        confirmLabel="Delete sample"
        destructive
        onConfirm={async () => {
          await wait(600)
          throw new Error('Could not delete')
        }}
      />
      <ConfirmDialog
        open={open === 'publish'}
        onClose={close}
        title="Publish the sample schedule?"
        message="Nothing is published in the gallery."
        confirmLabel="Publish schedule"
        onConfirm={() => undefined}
      />
    </Section>
  )
}

export function ToastsSection() {
  const toast = useToast()
  const count = useRef(0)
  return (
    <Section id="toasts" title="Toasts">
      <Example title="Kinds" note="Success and information disappear after 5 seconds. Warnings and errors stay. At most 3 are shown; the rest wait.">
        <Button onClick={() => toast.success('Sample entry saved')}>
          <Icon name="success" /> Success
        </Button>
        <Button onClick={() => toast.info('The sample week ends on Sunday')}>
          <Icon name="info" /> Information
        </Button>
        <Button onClick={() => toast.warning('This sample project is close to its budget')}>
          <Icon name="warning" /> Warning
        </Button>
        <Button onClick={() => toast.error('The sample could not be saved')}>
          <Icon name="error" /> Error
        </Button>
        <Button
          onClick={() => toast.success('Sample entry removed', { action: { label: 'Undo', onAction: () => toast.info('The sample is back') } })}
        >
          With an action
        </Button>
        <Button
          onClick={() => {
            for (let i = 0; i < 5; i++) toast.info(`Sample message ${++count.current}`)
          }}
        >
          Five at once
        </Button>
      </Example>
    </Section>
  )
}
