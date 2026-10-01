import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { translations, type Lang } from './translations'

type Dict = Record<keyof (typeof translations)['en'], string>

type Ctx = {
  lang: Lang
  t: Dict
  toggle: () => void
  setLang: (l: Lang) => void
}

const LanguageContext = createContext<Ctx | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('sq')
  const value = useMemo(
    () => ({
      lang,
      t: translations[lang] as Dict,
      setLang,
      toggle: () => setLang((l) => (l === 'en' ? 'sq' : 'en')),
    }),
    [lang],
  )
  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useI18n outside provider')
  return ctx
}
