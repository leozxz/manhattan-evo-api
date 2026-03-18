import { useState } from 'react'

const GroupIcon = () => (
  <svg viewBox="0 0 24 24" className="w-full h-full p-2 fill-[var(--color-text-muted)]">
    <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z" />
  </svg>
)

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" className="w-full h-full p-2 fill-[var(--color-text-muted)]">
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </svg>
)

interface AvatarProps {
  src?: string | null
  isGroup?: boolean
  size?: string
}

export function Avatar({ src, isGroup = false, size = 'w-10 h-10' }: AvatarProps) {
  const [failed, setFailed] = useState(false)

  return (
    <div className={`${size} rounded-full bg-[var(--color-panel-alt)] flex items-center justify-center overflow-hidden flex-shrink-0 ${!isGroup ? 'bg-[var(--color-accent-light)]' : ''}`}>
      {src && !failed ? (
        <img src={src} onError={() => setFailed(true)} className="w-full h-full object-cover" />
      ) : isGroup ? (
        <GroupIcon />
      ) : (
        <PersonIcon />
      )}
    </div>
  )
}
