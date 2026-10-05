import { useState } from 'react'
import KimiIcon, { type KimiIconName } from './KimiIcon'
import { useI18n } from './i18n/language-context'

// Reuse the reference icon treatment with Kidoland's working destinations.
const icons: Record<string, KimiIconName> = {
  dashboard: 'myKimi', attendance: 'kimiCode', reports: 'docs', program: 'build',
  meals: 'design', messages: 'openPlatform', announcements: 'slides', moments: 'inspiration',
  events: 'scheduled', children: 'newProject', payments: 'sheets', absences: 'plugins',
  incidents: 'kimiClaw', milestones: 'deepResearch', staff: 'kimiWork',
}

type Page = { view: string; label: string }

export default function KimiNavigation({ pages, activeView, onChoose, label }: { pages: Page[]; activeView: string; onChoose: (view: string) => void; label: string }) {
  const { t } = useI18n()
  const [navigation, setNavigation] = useState({ view: activeView, expanded: true })
  // Page search and dashboard shortcuts must reveal the newly selected link.
  if (navigation.view !== activeView) setNavigation({ view: activeView, expanded: true })
  const expanded = navigation.view !== activeView || navigation.expanded
  const dailyPages = pages.slice(0, 5)
  const secondaryPages = pages.slice(5).filter((page) => page.view !== 'children')
  const childPage = pages.find((page) => page.view === 'children')
  const link = (page: Page) => <button type="button" key={page.view} data-view={page.view} title={page.label} aria-current={activeView === page.view ? 'page' : undefined} onClick={() => onChoose(page.view)}><KimiIcon name={icons[page.view]} /><span>{page.label}</span></button>

  return <nav className="nav-links" aria-label={label}>
    <div className="nav-group">{dailyPages.map(link)}<button type="button" className="kimi-more" aria-expanded={expanded} aria-controls="workspace-more-pages" onClick={() => setNavigation({ view: activeView, expanded: !expanded })}><KimiIcon name="more" /><span>{expanded ? t.sidebarLess : t.sidebarMore}</span></button>
      <div id="workspace-more-pages" hidden={!expanded}>{secondaryPages.map(link)}</div>
    </div>
    {childPage && <div className="nav-group"><p className="nav-group-label">{t.navManagement}</p>{link(childPage)}</div>}
  </nav>
}
