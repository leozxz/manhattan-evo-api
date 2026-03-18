import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchInstances, connectInstance, restartInstance, logoutInstance, deleteInstance, createInstance } from '../api/instances'
import { useInstanceStore } from '../stores/instanceStore'
import { useUIStore } from '../stores/uiStore'
import type { Instance } from '../types'

export function useInstances() {
  const { setInstances, currentInstance, setCurrentInstance } = useInstanceStore()
  const addToast = useUIStore((s) => s.addToast)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['instances'],
    queryFn: async () => {
      const raw = await fetchInstances()
      const list: Instance[] = raw.map((r: any) => ({
        name: String(r.instance?.instanceName || r.instanceName || r.name || ''),
        state: (r.instance?.status || r.connectionStatus || 'unknown') as Instance['state'],
        profilePicUrl: r.instance?.profilePicUrl || undefined,
        number: r.instance?.owner?.split('@')[0] || undefined,
      })).filter((i: Instance) => i.name)
      setInstances(list)
      // Auto-select first connected or first
      if (!currentInstance || !list.find((i) => i.name === currentInstance)) {
        const connected = list.find((i) => i.state === 'open')
        if (connected) setCurrentInstance(connected.name)
        else if (list.length > 0) setCurrentInstance(list[0].name)
      }
      return list
    },
    refetchInterval: 30000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['instances'] })

  const connectMutation = useMutation({
    mutationFn: (name: string) => connectInstance(name),
    onSuccess: () => refresh(),
  })

  const restartMutation = useMutation({
    mutationFn: (name: string) => restartInstance(name),
    onSuccess: (_, name) => {
      addToast('Reiniciando "' + name + '"...')
      setTimeout(refresh, 3000)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: (name: string) => logoutInstance(name),
    onSuccess: (_, name) => { addToast('Desconectado "' + name + '"'); refresh() },
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteInstance(name),
    onSuccess: (_, name) => { addToast('Instancia "' + name + '" removida'); refresh() },
  })

  const createMutation = useMutation({
    mutationFn: ({ name, webhookUrl }: { name: string; webhookUrl?: string }) => createInstance(name, webhookUrl),
    onSuccess: () => { addToast('Instancia criada!'); refresh() },
    onError: () => addToast('Erro ao criar instancia', 'error'),
  })

  return { query, connectMutation, restartMutation, logoutMutation, deleteMutation, createMutation, refresh }
}
