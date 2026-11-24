import { useState } from 'react'
import { Button, type ButtonProps, IconButton, LinkButton } from '../../ui'
import { Example, Section } from './Section'

const variants = ['primary', 'secondary', 'quiet', 'destructive'] as const
const names = { primary: 'Primary', secondary: 'Secondary', quiet: 'Quiet', destructive: 'Destructive' }

function SavingButton(props: Pick<ButtonProps, 'variant' | 'size'>) {
  const [saving, setSaving] = useState(false)
  const [count, setCount] = useState(0)
  return (
    <>
      <Button
        {...props}
        loading={saving}
        loadingLabel="Saving"
        onClick={() => {
          setSaving(true)
          setCount((current) => current + 1)
          setTimeout(() => setSaving(false), 2000)
        }}
      >
        Save for 2 seconds
      </Button>
      <span>Saved {count} times</span>
    </>
  )
}

export function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons">
      <Example title="Medium">
        {variants.map((variant) => (
          <Button key={variant} variant={variant}>
            {names[variant]}
          </Button>
        ))}
      </Example>
      <Example title="Small">
        {variants.map((variant) => (
          <Button key={variant} variant={variant} size="small">
            {names[variant]}
          </Button>
        ))}
      </Example>
      <Example title="With an icon, and as a link">
        <Button variant="primary" icon="plus">
          New sample
        </Button>
        <Button icon="edit">Edit sample</Button>
        <Button variant="destructive" icon="trash">
          Delete sample
        </Button>
        <LinkButton to="/design/plain">Layout without navigation</LinkButton>
      </Example>
      <Example title="Icon only" note="The accessible name is required by the type.">
        <IconButton icon="plus" label="Add" variant="primary" />
        <IconButton icon="edit" label="Edit" variant="secondary" />
        <IconButton icon="more" label="More" />
        <IconButton icon="trash" label="Delete" variant="destructive" />
        <IconButton icon="edit" label="Edit, small" variant="secondary" size="small" />
      </Example>
      <Example title="Disabled">
        {variants.map((variant) => (
          <Button key={variant} variant={variant} disabled>
            {names[variant]}
          </Button>
        ))}
        <IconButton icon="plus" label="Add, not possible now" disabled />
      </Example>
      <Example title="Loading" note="Keeps its width and focus, and ignores clicks.">
        {variants.map((variant) => (
          <Button key={variant} variant={variant} loading>
            {names[variant]}
          </Button>
        ))}
        <SavingButton variant="primary" />
      </Example>
    </Section>
  )
}
