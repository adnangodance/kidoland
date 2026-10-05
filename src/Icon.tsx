import type { CSSProperties } from 'react'

const paths = {
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  attendance: 'M9 4h6 M9 3v3h6V3z M7 4H5v17h14V4h-2 M8 13l3 3 5-6',
  reports: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
  program: 'M4 4h16v16H4z M4 9h16 M9 9v11 M8 2v4 M16 2v4',
  announcements: 'M4 10v5h4l11 4V6L8 10z M8 15l2 6h3 M22 10v5',
  payments: 'M3 5h18v14H3z M3 10h18 M7 15h3',
  messages: 'M21 11a9 9 0 0 1-9 9H4l-2 2v-9a9 9 0 0 1 18-6 M7 11h9 M7 15h5',
  absences: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M9 14l6 4 M15 14l-6 4',
  meals: 'M4 3v6a3 3 0 0 0 6 0V3 M7 3v18 M17 3v18 M17 3c-4 3-4 10 0 10h3V3z',
  incidents: 'M12 3l9 4v5c0 5-9 9-9 9s-9-4-9-9V7z M12 8v8 M8 12h8',
  moments: 'M3 7h4l2-3h6l2 3h4v14H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  events: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2 M8 18h2',
  staff: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M19 4a3 3 0 0 1 0 6 M22 21v-3a6 6 0 0 0-3-5',
  milestones: 'M4 21V11 M10 21V7 M16 21V3 M22 21H2 M4 7l6-4 6-1',
  children: 'M9 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M1 21v-3a5 5 0 0 1 10 0v3 M13 21v-3a5 5 0 0 1 10 0v3',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  check: 'M5 12l4 4L19 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  close: 'M6 6l12 12 M18 6L6 18',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
  leaf: 'M20 3c0 12-5 17-11 14C2 14 5 3 20 3z M4 21L15 9',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M15 15l6 6',
  logout: 'M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
} as const

export type IconName = keyof typeof paths

export default function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className} style={style}><path d={paths[name]} /></svg>
}

export function BrandMark() {
  return <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false"><rect width="40" height="40" rx="13" fill="currentColor" /><path d="M20 30V19M20 23C11 24 8 17 9 12c7-1 12 3 11 11Z" fill="#cde6ba" /><path d="M20 19C19 12 25 9 31 10c1 6-4 11-11 9Z" fill="#f3cc79" /></svg>
}
