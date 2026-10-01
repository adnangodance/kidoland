import { useEffect, useRef } from 'react'
import { validDate } from './attendance-date.js'
export function useAlive() {
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return alive
}
export function euro(cents: number | string, lang: string, currency = 'EUR') {
  const exact = BigInt(cents)
  const whole = exact / 100n
  const fraction = (exact % 100n).toString().padStart(2, '0')
  const locale = lang === 'sq' ? 'sq-AL' : 'en-GB'
  const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  try {
    return new Intl.NumberFormat(locale, { ...options, style: 'currency', currency }).formatToParts(whole)
      .map((part) => part.type === 'fraction' ? fraction : part.value).join('')
  } catch {
    const amount = new Intl.NumberFormat(locale, options).formatToParts(whole)
      .map((part) => part.type === 'fraction' ? fraction : part.value).join('')
    return `${amount} ${currency}`
  }
}
export function displayDate(date: string, lang: string) {
  if (!validDate(date)) return date
  return new Intl.DateTimeFormat(lang === 'sq' ? 'sq-AL' : 'en-GB').format(new Date(`${date}T12:00:00`))
}
