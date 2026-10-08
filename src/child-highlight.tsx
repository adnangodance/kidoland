import { isSeaGodanci } from './child-highlight-util'

export function SeaGodanciBadge({ name }: { name?: string | null }) {
  if (!isSeaGodanci(name)) return null
  return (
    <span className="sea-godanci-badge" title="Parent: Adnan Godanci">
      <span className="sea-godanci-star" aria-hidden="true">⭐</span>
      <span className="sea-godanci-name">Sea Godanci</span>
      <span className="sea-godanci-parent-tag">Prindi: Adnan Godanci</span>
    </span>
  )
}
