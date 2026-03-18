import { create } from 'zustand'
import type { Toast, Page } from '../types'

interface UIState {
  activePage: Page
  showGroupPanel: boolean
  showKnowledgePanel: boolean
  toasts: Toast[]
  setPage: (page: Page) => void
  toggleGroupPanel: () => void
  toggleKnowledgePanel: () => void
  addToast: (message: string, type?: 'success' | 'error') => void
  dismissToast: (id: string) => void
}

let toastId = 0

export const useUIStore = create<UIState>((set) => ({
  activePage: 'connect',
  showGroupPanel: false,
  showKnowledgePanel: false,
  toasts: [],
  setPage: (page) => set({ activePage: page }),
  toggleGroupPanel: () => set((s) => ({ showGroupPanel: !s.showGroupPanel, showKnowledgePanel: false })),
  toggleKnowledgePanel: () => set((s) => ({ showKnowledgePanel: !s.showKnowledgePanel, showGroupPanel: false })),
  addToast: (message, type = 'success') => {
    const id = String(++toastId)
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
