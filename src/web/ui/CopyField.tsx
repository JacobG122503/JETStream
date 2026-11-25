import { useRef, useState } from 'react'
import { announce } from './announce'
import { Button } from './Button'
import { TextField } from './fields'
import './CopyField.css'

export interface CopyFieldProps {
  label: string
  value: string
}

/** Text to take elsewhere, such as a link. */
export function CopyField({ label, value }: CopyFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<'copied' | 'selected' | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setResult('copied')
      announce('Copied')
    } catch {
      // Browsers allow copying only over https, or when the person permits it.
      input.current?.focus()
      input.current?.select()
      setResult('selected')
      announce('Selected. Copy it with the keyboard.')
    }
  }

  return (
    <div className="copy-field">
      <TextField
        ref={input}
        label={label}
        value={value}
        readOnly
        spellCheck={false}
        autoComplete="off"
        hint={result === 'selected' ? 'Selected: copy it with Ctrl+C, or Command+C on a Mac.' : undefined}
        onChange={() => undefined}
        onFocus={(event) => event.target.select()}
      />
      <Button icon={result === 'copied' ? 'check' : 'copy'} onClick={() => void copy()}>
        {result === 'copied' ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
