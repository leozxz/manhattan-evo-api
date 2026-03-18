import { Sidebar } from './Sidebar'
import { useUIStore } from '../stores/uiStore'
import { useInstanceStore } from '../stores/instanceStore'
import { ConnectionsPage } from '../pages/ConnectionsPage'
import { ChatPage } from '../pages/ChatPage'
import { ToastContainer } from '../components/common/Toast'

export function AppLayout() {
  const activePage = useUIStore((s) => s.activePage)
  const { instances, currentInstance, setCurrentInstance } = useInstanceStore()

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-14 bg-[var(--color-panel)] border-b border-[var(--color-border)] flex items-center px-5 gap-4 flex-shrink-0">
          <h1 className="text-base font-bold text-[var(--color-text)]">Manhattan</h1>
          <div className="flex-1" />
          {instances.length > 0 && (
            <select
              value={currentInstance}
              onChange={(e) => setCurrentInstance(e.target.value)}
              className="text-sm bg-[var(--color-panel-alt)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-[var(--color-text)]"
            >
              {instances.map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} {i.state === 'open' ? '🟢' : '🔴'}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activePage === 'connect' && <ConnectionsPage />}
          {activePage === 'chat' && <ChatPage />}
          {activePage === 'group' && (
            <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
              Grupos — em breve
            </div>
          )}
          {activePage === 'dashboard' && (
            <div className="flex items-center justify-center h-full text-[var(--color-text-muted)]">
              Dashboard — em breve
            </div>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  )
}
