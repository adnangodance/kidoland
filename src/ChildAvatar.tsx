function getChildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_PALETTES = [
  { bg: '#e8f5e9', color: '#1b5e20', border: '#c8e6c9' }, // cheerful mint
  { bg: '#fff3e0', color: '#b74b00', border: '#ffe0b2' }, // warm sunshine orange
  { bg: '#e3f2fd', color: '#0d47a1', border: '#bbdefb' }, // soft sky blue
  { bg: '#f3e5f5', color: '#6a1b9a', border: '#e1bee7' }, // playful lavender
  { bg: '#fffde7', color: '#827717', border: '#fff59d' }, // bright buttercup
  { bg: '#fce4ec', color: '#880e4f', border: '#f8bbd0' }, // soft rose
  { bg: '#e0f2f1', color: '#004d40', border: '#80cbc4' }, // ocean teal
]

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % AVATAR_PALETTES.length
  return AVATAR_PALETTES[index]
}

export default function ChildAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = getChildInitials(name)
  const palette = getAvatarColor(name)
  return (
    <span
      className="child-avatar"
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        backgroundColor: palette.bg,
        color: palette.color,
        border: `1.5px solid ${palette.border}`,
      }}
    >
      {initials}
    </span>
  )
}
