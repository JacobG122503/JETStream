/** Line icons on a 24px grid, drawn for JETStream. The values are SVG path data. */
const paths = {
  bell: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15ZM10 20.5h4',
  approvals: 'M8 4.5H5v16h14v-16h-3M8.5 3h7v3.5h-7ZM8.5 13l2.5 2.5 4.5-5',
  star: 'M12 4l2.4 5 5.6.7-4.1 3.9 1 5.5L12 16.4 7.1 19l1-5.5L4 9.7l5.6-.7Z',
  tasks: 'M4.5 4.5h15v11l-4 4h-11ZM15.5 19.5v-4h4M8 10.5l2.5 2.5L15 8.5',
  timer: 'M12 6.5a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM12 10v3.5l2 1.5M9.5 3.5h5M12 3.5v3M18 7l1.5-1.5',
  timeAdd: 'M11 4.5a7.5 7.5 0 1 0 7.5 9M11 8.5V12l2.5 1.5M18 4v6M15 7h6',
  expenseAdd: 'M19.5 13v6.5h-15v-15H12M12 8.5c-2 0-3 .8-3 1.8 0 2.4 5 1.2 5 3.6 0 1-1 1.8-2.6 1.8-1.4 0-2.3-.5-2.6-1.4M18 3v6M15 6h6',
  home: 'M4 11 12 4l8 7v9h-5.5v-5.5h-5V20H4Z',
  play: 'M8 5.5v13l10.5-6.5Z',
  stop: 'M7 7h10v10H7Z',
  shield: 'M12 3.5 5 6v5.5c0 4.4 2.9 7.4 7 9 4.1-1.6 7-4.6 7-9V6Z',
  send: 'M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4Z',
  printer: 'M7 8.5v-5h10v5M7 17H4v-8.5h16V17h-3M7 14h10v6.5H7Z',
  trend: 'M3.5 16.5 9 11l4 4 7.5-8M15 7h5.5v5.5',
  time: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.5V12l3 2',
  expenses: 'M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5ZM9 8h6M9 11.5h6M9 15h3',
  projects: 'M3.5 6.5h6l2 2.5h9v10.5h-17ZM3.5 9V6.5',
  clients: 'M5.5 20.5v-17h8v17M13.5 9h5v11.5M3 20.5h18M8.5 7.5h2M8.5 11h2M8.5 14.5h2',
  team: 'M9 4.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5ZM3 19.5c0-3.3 2.6-5.5 6-5.5s6 2.2 6 5.5M15.5 5a3.25 3.25 0 0 1 0 5.6M17.5 14.5c2.2.7 3.5 2.6 3.5 5',
  schedule: 'M4 5.5h16v15H4ZM4 10h16M8 3v4M16 3v4M8 13.5h4M12 17h4',
  timeOff: 'M12 6.5V20M12 6.5c-4.7 0-8.2 2.6-8.5 6.5h17c-.3-3.9-3.8-6.5-8.5-6.5ZM12 6.5V4M12 20a2.3 2.3 0 0 1-4.6 0',
  reports: 'M3.5 20.5h17M6.5 17.5v-5M12 17.5V5M17.5 17.5V9',
  invoices: 'M6 3.5h8l4.5 4.5v12.5H6ZM14 3.5V8h4.5M9.5 12.5h5.5M9.5 16h5.5',
  estimates: 'M3.5 15.5 15.5 3.5l5 5-12 12ZM7.5 11.5l2 2M10.5 8.5l2.5 2.5M13.5 5.5l2 2',
  settings: 'M4 7h8M17 7h3M4 17h3M12 17h8M14.5 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM9.5 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevronDown: 'M6.5 9.5 12 15l5.5-5.5',
  chevronLeft: 'M14.5 6.5 9 12l5.5 5.5',
  chevronRight: 'M9.5 6.5 15 12l-5.5 5.5',
  chevronsLeft: 'M11.5 6.5 6 12l5.5 5.5M18 6.5 12.5 12l5.5 5.5',
  chevronsRight: 'M12.5 6.5 18 12l-5.5 5.5M6 6.5l5.5 5.5L6 17.5',
  arrowLeft: 'M19 12H5M11.5 5.5 5 12l6.5 6.5',
  arrowRight: 'M5 12h14M12.5 5.5 19 12l-6.5 6.5',
  arrowUp: 'M12 19V5M6.5 10.5 12 5l5.5 5.5',
  arrowDown: 'M12 5v14M6.5 13.5 12 19l5.5-5.5',
  sort: 'M8.5 9.5 12 6l3.5 3.5M8.5 14.5 12 18l3.5-3.5',
  search: 'M10.5 4.5a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM15 15l5 5',
  calendar: 'M4 5.5h16v15H4ZM4 10h16M8 3v4M16 3v4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z',
  monitor: 'M3.5 4.5h17v11.5h-17ZM9 20h6M12 16v4',
  success: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM8 12.5l2.7 2.7L16 9.5',
  info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v5.5M12 7.5v.2',
  warning: 'M12 4 2.8 19.5h18.4ZM12 10v4.5M12 17v.2',
  error: 'M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7ZM12 7.5v5.5M12 16.3v.2',
  more: 'M5.5 12h.1M12 12h.1M18.5 12h.1',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4.5 19.5l1-4.5L16 4.5l3.5 3.5L9 18.5ZM13.5 7l3.5 3.5',
  trash: 'M4.5 6.5h15M9 6.5v-3h6v3M6.5 6.5l1 14h9l1-14M10.5 10.5v6M13.5 10.5v6',
  copy: 'M8.5 8.5h12v12h-12ZM15.5 8.5v-5h-12v12h5',
  inbox: 'M3.5 13.5 6 4.5h12l2.5 9v6h-17ZM3.5 13.5h5l1.5 2.5h4l1.5-2.5h5',
  lock: 'M5.5 11h13v9.5h-13ZM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  unlock: 'M5.5 11h13v9.5h-13ZM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2',
  eye: 'M2.5 12c2.2-4.2 5.4-6.3 9.5-6.3s7.3 2.1 9.5 6.3c-2.2 4.2-5.4 6.3-9.5 6.3S4.7 16.2 2.5 12ZM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
  eyeOff: 'M4 4l16 16M9.9 5.9c.7-.1 1.4-.2 2.1-.2 4.1 0 7.3 2.1 9.5 6.3-.8 1.5-1.7 2.7-2.8 3.7M6.2 7.4C4.7 8.5 3.5 10 2.5 12c2.2 4.2 5.4 6.3 9.5 6.3 1.6 0 3-.3 4.3-.9M10 10.1a2.8 2.8 0 0 0 3.9 3.9',
  user: 'M12 4a3.75 3.75 0 1 0 0 7.5A3.75 3.75 0 0 0 12 4ZM4.5 20.5c0-3.9 3-6.5 7.5-6.5s7.5 2.6 7.5 6.5',
  signOut: 'M10 4H4.5v16H10M9.5 12h11M16.5 8l4 4-4 4',
  compass: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM15.5 8.5l-2 5-5 2 2-5Z',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9M19.5 4v5h-5',
  dollar: 'M16.5 8c-.5-1.6-2.1-2.5-4.5-2.5-2.6 0-4.5 1.1-4.5 3.1 0 4.6 9.3 2.2 9.3 6.8 0 2-2 3.1-4.8 3.1-2.6 0-4.4-1-4.9-2.7M12 3v18',
} as const

export type IconName = keyof typeof paths

export interface IconProps {
  name: IconName
  className?: string
}

/** Decorative: the text next to it, or the name of its button, carries the meaning. */
export function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 2.75 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}
