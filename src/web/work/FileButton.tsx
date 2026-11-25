import { type ReactNode, useRef } from 'react'
import { Button, type IconName } from '../ui'

interface FileButtonProps {
  accept: string
  icon?: IconName
  /** Also the name of the field, for those who do not see the button. */
  label: string
  children?: ReactNode
  onChoose: (file: File) => void
}

/** Chooses a file. */
export function FileButton({ accept, icon, label, children, onChoose }: FileButtonProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-label={label}
        onChange={(event) => {
          const [file] = event.target.files ?? []
          event.target.value = ''
          if (file) onChoose(file)
        }}
      />
      <Button icon={icon} onClick={() => input.current?.click()}>
        {children ?? label}
      </Button>
    </>
  )
}
