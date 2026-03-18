import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Instance } from '../types'

interface InstanceState {
  instances: Instance[]
  currentInstance: string
  sseConnected: boolean
  setInstances: (instances: Instance[]) => void
  setCurrentInstance: (name: string) => void
  updateInstanceState: (name: string, state: Instance['state']) => void
  setSseConnected: (val: boolean) => void
}

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set) => ({
      instances: [],
      currentInstance: '',
      sseConnected: false,
      setInstances: (instances) => set({ instances }),
      setCurrentInstance: (name) => set({ currentInstance: name }),
      updateInstanceState: (name, state) =>
        set((s) => ({
          instances: s.instances.map((i) => (i.name === name ? { ...i, state } : i)),
        })),
      setSseConnected: (val) => set({ sseConnected: val }),
    }),
    {
      name: 'manhattan-instances',
      partialize: (s) => ({ instances: s.instances, currentInstance: s.currentInstance }),
    },
  ),
)
