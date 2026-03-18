import { useUIStore } from '../stores/uiStore'
import type { Page } from '../types'

const navItems: { page: Page; label: string; icon: React.ReactNode }[] = [
  {
    page: 'connect',
    label: 'Conexoes',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
      </svg>
    ),
  },
  {
    page: 'group',
    label: 'Grupos',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5z" />
      </svg>
    ),
  },
  {
    page: 'chat',
    label: 'Mensagens',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
      </svg>
    ),
  },
  {
    page: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" />
      </svg>
    ),
  },
]

export function Sidebar() {
  const { activePage, setPage } = useUIStore()

  return (
    <div className="w-[72px] bg-[var(--color-sidebar)] flex flex-col items-center py-4 gap-2 flex-shrink-0">
      {/* Logo */}
      <div className="w-10 h-10 rounded-xl bg-[var(--color-accent)] flex items-center justify-center mb-4">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        </svg>
      </div>

      {/* Nav buttons */}
      {navItems.map(({ page, label, icon }) => (
        <button
          key={page}
          onClick={() => setPage(page)}
          title={label}
          className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
            activePage === page
              ? 'bg-[var(--color-accent)] fill-white text-white'
              : 'fill-gray-400 text-gray-400 hover:bg-[var(--color-sidebar-hover)]'
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
