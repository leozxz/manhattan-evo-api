import { useUIStore } from '../../stores/uiStore'

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts)
  const dismiss = useUIStore((s) => s.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-in ${
            t.type === 'error' ? 'bg-red-500 text-white' : 'bg-[var(--color-accent)] text-white'
          }`}
        >
          <span>{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}
