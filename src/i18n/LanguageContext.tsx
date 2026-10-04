import {
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import { translations, type Lang } from './translations'
import { LanguageContext, type Dict } from './language-context'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => localStorage.getItem('kidoland.language') === 'en' ? 'en' : 'sq')
  useEffect(() => { localStorage.setItem('kidoland.language', lang); document.documentElement.lang = lang }, [lang])
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
