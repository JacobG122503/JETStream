import { useId } from 'react'

interface StreamLinesProps {
  className?: string
  /** How many lines. */
  count?: number
  width?: number
  height?: number
}

/** Currents of air: the picture behind the product's name. Decorative. */
export function StreamLines({ className, count = 14, width = 600, height = 600 }: StreamLinesProps) {
  const gradient = useId()
  const lines = Array.from({ length: count }, (_, index) => {
    const part = index / (count - 1)
    const start = height * (0.18 + part * 0.95)
    const sway = height * (0.2 + 0.16 * Math.sin(part * 4.2))
    const end = height * (-0.1 + part * 0.82)
    const at = (x: number, y: number) => `${Math.round(x * width)} ${Math.round(y)}`
    return {
      path: `M${at(-0.1, start)} C${at(0.3, start - sway)} ${at(0.55, start + sway * 0.55)} ${at(0.78, (start + end) / 2)} S${at(1.02, end)} ${at(1.15, end - sway * 0.4)}`,
      opacity: Number((0.12 + 0.5 * Math.sin(part * Math.PI)).toFixed(2)),
      weight: Number((1 + 1.4 * Math.sin(part * Math.PI)).toFixed(2)),
    }
  })
  return (
    <svg className={className ? `stream ${className}` : 'stream'} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" className="stream-b" stopOpacity="0" />
          <stop offset="0.45" className="stream-a" />
          <stop offset="1" className="stream-b" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {lines.map(({ path, opacity, weight }) => (
        <path key={path} d={path} stroke={`url(#${gradient})`} strokeWidth={weight} opacity={opacity} />
      ))}
    </svg>
  )
}
