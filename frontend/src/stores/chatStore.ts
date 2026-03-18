import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Chat, ChatFilter, Message } from '../types'

interface ChatState {
  allChats: Chat[]
  selectedChat: Chat | null
  chatFilter: ChatFilter
  contactNames: Record<string, string>
  lidToPhone: Record<string, string>
  groupLastMsg: Record<string, number>
  chatLastSeen: Record<string, number>
  deletedChats: Record<string, number>
  replyingTo: Message | null

  setChats: (chats: Chat[]) => void
  selectChat: (chat: Chat | null) => void
  setChatFilter: (filter: ChatFilter) => void
  setContactName: (jid: string, name: string) => void
  setLidToPhone: (lid: string, phone: string) => void
  markChatRead: (chatId: string) => void
  updateChatFromSSE: (chatId: string, updates: Partial<Chat>) => void
  updateGroupLastMsg: (chatId: string, ts: number) => void
  deleteChat: (chatId: string) => void
  setReplyingTo: (msg: Message | null) => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      allChats: [],
      selectedChat: null,
      chatFilter: 'all',
      contactNames: {},
      lidToPhone: {},
      groupLastMsg: {},
      chatLastSeen: {},
      deletedChats: {},
      replyingTo: null,

      setChats: (allChats) => set({ allChats }),
      selectChat: (chat) => {
        if (chat) {
          set((s) => ({
            selectedChat: chat,
            chatLastSeen: { ...s.chatLastSeen, [chat.id]: Math.floor(Date.now() / 1000) },
            allChats: s.allChats.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c)),
          }))
        } else {
          set({ selectedChat: null })
        }
      },
      setChatFilter: (chatFilter) => set({ chatFilter }),
      setContactName: (jid, name) => set((s) => ({ contactNames: { ...s.contactNames, [jid]: name } })),
      setLidToPhone: (lid, phone) => set((s) => ({ lidToPhone: { ...s.lidToPhone, [lid]: phone } })),
      markChatRead: (chatId) =>
        set((s) => ({
          allChats: s.allChats.map((c) => (c.id === chatId ? { ...c, unreadCount: 0 } : c)),
          chatLastSeen: { ...s.chatLastSeen, [chatId]: Math.floor(Date.now() / 1000) },
        })),
      updateChatFromSSE: (chatId, updates) =>
        set((s) => ({
          allChats: s.allChats.map((c) => (c.id === chatId ? { ...c, ...updates } : c)),
        })),
      updateGroupLastMsg: (chatId, ts) =>
        set((s) => ({
          groupLastMsg: { ...s.groupLastMsg, [chatId]: Math.max(ts, s.groupLastMsg[chatId] || 0) },
        })),
      deleteChat: (chatId) =>
        set((s) => ({
          deletedChats: { ...s.deletedChats, [chatId]: Date.now() },
          allChats: s.allChats.filter((c) => c.id !== chatId),
        })),
      setReplyingTo: (msg) => set({ replyingTo: msg }),
    }),
    {
      name: 'manhattan-chats',
      partialize: (s) => ({
        groupLastMsg: s.groupLastMsg,
        chatLastSeen: s.chatLastSeen,
        deletedChats: s.deletedChats,
      }),
    },
  ),
)
