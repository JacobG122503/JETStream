import type { ReactNode } from 'react'
import { classNames } from './classNames'
import './charts.css'

export interface ChartSeries {
  id: string
  label: string
  /** Which of the chart colours. */
  colour: 1 | 2 | 3 | 4 | 5 | 6 | 'rest'
}

export interface ChartPoint {
  id: string
  /** Under the bar. */
  label: string
  /** In the tooltip and for screen readers. */
  title: string
  values: number[]
  current?: boolean
}

interface BarChartProps {
  /** Says what it shows. */
  label: string
  series: ChartSeries[]
  points: ChartPoint[]
  format: (value: number) => string
  /** One bar on the other, or side by side. */
  look?: 'stacked' | 'grouped'
  /** What the axis counts in, such as 60 for hours of minutes. */
  unit?: number
  /** Shows every label, or only so many that they fit. */
  everyLabel?: number
}

/** The axis ends at a round value. */
function niceMaximum(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 3, 4, 5, 6, 8, 10].find((candidate) => candidate * power >= value) ?? 10
  return step * power
}

const colour = (series: ChartSeries) => `var(--c-chart-${series.colour})`

export function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="legend">
      {series.map((item) => (
        <li key={item.id}>
          <span className="legend-key" style={{ background: colour(item) }} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/** Columns over time. The figures are in a table for screen readers, and in the tooltips. */
export function BarChart({ label, series, points, format, look = 'stacked', unit = 1, everyLabel = 1 }: BarChartProps) {
  const heights = points.map(({ values }) => (look === 'stacked' ? values.reduce((sum, value) => sum + value, 0) : Math.max(0, ...values)))
  const top = niceMaximum(Math.max(0, ...heights) / unit) * unit
  return (
    <figure className="chart">
      <div className="chart-plot" aria-hidden="true">
        <div className="chart-axis">
          <span>{format(top)}</span>
          <span>{format(top / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <div className="chart-area">
          <div className="chart-grid">
            <span />
            <span />
            <span />
          </div>
          <div className="chart-bars">
            {points.map(({ id, label: name, title, values, current }, index) => (
              <div key={id} className={classNames('chart-column', current && 'is-current')}>
                <div className={`chart-stack chart-${look}`}>
                  {series.map((item, position) => (
                    <span key={item.id} style={{ height: `${((values[position] ?? 0) / top) * 100}%`, background: colour(item) }} />
                  ))}
                </div>
                <span className="chart-label">{index % everyLabel === 0 ? name : ''}</span>
                <span className="chart-tip">
                  <strong>{title}</strong>
                  {series.map((item, position) => (
                    <span key={item.id}>
                      <span className="legend-key" style={{ background: colour(item) }} /> {item.label}: {format(values[position] ?? 0)}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Period</th>
              {series.map((item) => (
                <th key={item.id} scope="col">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map(({ id, title, values }) => (
              <tr key={id}>
                <th scope="row">{title}</th>
                {series.map((item, position) => (
                  <td key={item.id}>{format(values[position] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

interface RingProps {
  /** 0 to 100, or more. */
  percent: number
  label: string
  /** In the middle. */
  children?: ReactNode
  size?: 'medium' | 'large'
}

export function Ring({ percent, label, children, size = 'medium' }: RingProps) {
  const shown = Math.max(0, Math.min(100, percent))
  return (
    <div className={classNames('ring', `ring-${size}`, percent > 100 && 'is-over')} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" focusable="false" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r="42" />
        <circle className="ring-fill" cx="50" cy="50" r="42" pathLength="100" strokeDasharray={`${shown} 100`} />
      </svg>
      <div className="ring-content" aria-hidden="true">
        {children}
      </div>
    </div>
  )
}

/** A bar inside a table cell or list. The figure is next to it. */
export function Meter({ percent, over = false }: { percent: number; over?: boolean }) {
  return (
    <span className={classNames('meter', over && 'is-over')} aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </span>
  )
}
