import { useState } from 'react'
import { useInstances } from '../hooks/useInstances'
import { useInstanceStore } from '../stores/instanceStore'
import { Spinner } from '../components/common/Spinner'

export function ConnectionsPage() {
  const { query, connectMutation, restartMutation, logoutMutation, deleteMutation, createMutation } = useInstances()
  const { instances, currentInstance, setCurrentInstance } = useInstanceStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')

  const handleCreate = () => {
    if (!newName.trim()) return
    createMutation.mutate({ name: newName.trim() })
    setNewName('')
    setShowCreate(false)
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold">Instancias WhatsApp</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-[var(--color-accent)] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[var(--color-accent-hover)] transition"
        >
          + Nova Instancia
        </button>
      </div>

      {query.isLoading && (
        <div className="flex justify-center py-12"><Spinner /></div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {instances.map((inst) => (
          <div
            key={inst.name}
            onClick={() => setCurrentInstance(inst.name)}
            className={`bg-[var(--color-panel)] rounded-xl p-5 shadow-sm border-2 cursor-pointer transition-all hover:shadow-md ${
              currentInstance === inst.name ? 'border-[var(--color-accent)]' : 'border-transparent'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-3 h-3 rounded-full ${inst.state === 'open' ? 'bg-green-500' : inst.state === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-red-400'}`} />
              <span className="font-semibold text-sm truncate">{inst.name}</span>
            </div>
            {inst.number && (
              <div className="text-xs text-[var(--color-text-muted)] mb-3">+{inst.number}</div>
            )}
            <div className="text-xs text-[var(--color-text-muted)] mb-4 capitalize">{inst.state}</div>
            <div className="flex gap-2 flex-wrap">
              {inst.state !== 'open' && (
                <button
                  onClick={(e) => { e.stopPropagation(); connectMutation.mutate(inst.name) }}
                  className="text-xs bg-[var(--color-accent)] text-white px-3 py-1 rounded-lg hover:bg-[var(--color-accent-hover)]"
                >
                  Conectar
                </button>
              )}
              {inst.state === 'open' && (
                <button
                  onClick={(e) => { e.stopPropagation(); restartMutation.mutate(inst.name) }}
                  className="text-xs bg-[var(--color-panel-alt)] px-3 py-1 rounded-lg hover:bg-[var(--color-border)]"
                >
                  Reiniciar
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); logoutMutation.mutate(inst.name) }}
                className="text-xs bg-[var(--color-panel-alt)] px-3 py-1 rounded-lg hover:bg-[var(--color-border)]"
              >
                Desconectar
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('Excluir instancia "' + inst.name + '"?')) deleteMutation.mutate(inst.name)
                }}
                className="text-xs text-red-500 bg-red-50 px-3 py-1 rounded-lg hover:bg-red-100"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={() => setShowCreate(false)}>
          <div className="bg-[var(--color-panel)] rounded-xl p-6 w-[360px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-4">Nova Instancia</h3>
            <input
              type="text"
              placeholder="Nome da instancia"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
              className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm mb-4 outline-none focus:border-[var(--color-accent)]"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm rounded-lg bg-[var(--color-panel-alt)] hover:bg-[var(--color-border)]">
                Cancelar
              </button>
              <button onClick={handleCreate} className="px-4 py-2 text-sm rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] font-semibold">
                Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
