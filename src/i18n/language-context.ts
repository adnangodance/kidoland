import { createContext, useContext } from 'react'
import { translations, type Lang } from './translations'

export type Dict = Record<keyof (typeof translations)['en'], string>

export type LanguageCtx = {
  lang: Lang
  t: Dict
  toggle: () => void
  setLang: (l: Lang) => void
}

// Lives outside the provider component module so Vite Fast Refresh keeps the
// same context identity when LanguageContext.tsx is edited.
export const LanguageContext = createContext<LanguageCtx | null>(null)

export function useI18n() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useI18n outside provider')
  return ctx
}
