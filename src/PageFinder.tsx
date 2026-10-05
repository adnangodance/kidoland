import { useEffect, useRef, useState } from 'react'
import Icon, { type IconName } from './Icon'
import { useI18n } from './i18n/language-context'

export type PageChoice = { view: string; label: string; icon: IconName; group: string }

export default function PageFinder({ pages, onChoose, onDismiss }: { pages: PageChoice[]; onChoose: (view: string) => void; onDismiss: () => void }) {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const navigating = useRef(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const matches = pages.filter((page) => `${page.label} ${page.group}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element.showModal()
    input.current?.focus()
    return () => {
      element.close()
      if (!navigating.current) previous?.focus({ preventScroll: true })
    }
  }, [])

  function choose(page: PageChoice) {
    navigating.current = true
    onChoose(page.view)
  }

  return <dialog ref={dialog} className="page-finder" aria-label={t.searchPages} onCancel={(event) => { event.preventDefault(); onDismiss() }} onClick={(event) => { if (event.target === dialog.current) { const box = dialog.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onDismiss() } }}>
    <div className="finder-input"><Icon name="search" /><input ref={input} type="search" aria-label={t.searchPages} placeholder={t.searchPagesPlaceholder} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const next = matches.length ? (active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length : 0
        setActive(next)
        dialog.current?.querySelectorAll<HTMLButtonElement>('.finder-result')[next]?.scrollIntoView({ block: 'nearest' })
      }
      if (event.key === 'Enter' && matches[active]) { event.preventDefault(); choose(matches[active]) }
    }} /><button type="button" aria-label={t.closeSearch} onClick={onDismiss}><Icon name="close" size={18} /></button></div>
    <div className="finder-results" aria-label={t.pages}>
      {matches.length ? matches.map((page, index) => <button key={page.view} type="button" className={`finder-result ${active === index ? 'is-highlighted' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => choose(page)}><Icon name={page.icon} size={18} /><span>{page.label}<small>{page.group}</small></span><Icon name="arrow" size={16} /></button>) : <p className="finder-empty" role="status">{t.noPagesFound}</p>}
    </div>
    <div className="finder-help"><span>{t.searchKeyboardHint}</span><span>Esc · {t.closeSearch}</span></div>
  </dialog>
}
