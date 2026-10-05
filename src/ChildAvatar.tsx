function getChildInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_PALETTES = [
  { bg: '#e0efe3', color: '#3f654b', border: '#c9e2cf' },
  { bg: '#fbe4d5', color: '#89543c', border: '#f0ceb9' },
  { bg: '#deedf9', color: '#416483', border: '#c6dfef' },
  { bg: '#ece3f8', color: '#70558a', border: '#ded0ee' },
  { bg: '#fff0c8', color: '#7b602a', border: '#f0dda3' },
  { bg: '#fae2e7', color: '#8f4d61', border: '#f0cbd5' },
  { bg: '#daf0ed', color: '#3e716b', border: '#bee2dc' },
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
        border: `1px solid ${palette.border}`,
      }}
    >
      {initials}
    </span>
  )
}
