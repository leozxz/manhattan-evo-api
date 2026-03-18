import { useEffect } from 'react'
import { useInstanceStore } from '../stores/instanceStore'
import { useChatStore } from '../stores/chatStore'
import { useUIStore } from '../stores/uiStore'
import { getMessagePreview } from '../lib/message'

export function useSSE() {

  useEffect(() => {
    const es = new EventSource('/events')

    es.addEventListener('connected', () => {
      useInstanceStore.getState().setSseConnected(true)
    })

    es.addEventListener('webhook', (e) => {
      try {
        const payload = JSON.parse(e.data)
        const event = payload.event || ''
        const state = useChatStore.getState()

        if (event === 'messages.upsert') {
          const d = payload.data || payload
          const key = d.key || {}
          if (key.fromMe) return

          const remoteJid = key.remoteJid || ''
          const chat = state.allChats.find((c) => c.id === remoteJid || c.messageJid === remoteJid)
          if (chat && (chat.id === state.selectedChat?.id)) return

          if (chat) {
            const msg = d.message || {}
            const preview = getMessagePreview(msg)
            useChatStore.getState().updateChatFromSSE(chat.id, {
              unreadCount: (chat.unreadCount || 0) + 1,
              lastMsgPreview: preview.length > 80 ? preview.substring(0, 80) + '...' : preview,
              lastMsgFromMe: false,
            })
          }

          const ts = d.messageTimestamp
          if (ts && chat) {
            const numTs = typeof ts === 'string' ? parseInt(ts) : ts
            useChatStore.getState().updateGroupLastMsg(chat.id, numTs)
          }
          if (d.pushName && chat) {
            useChatStore.getState().setContactName(chat.id, d.pushName)
          }
        }

        if (event === 'connection.update') {
          const instName = payload.instance || payload.data?.instance
          const connState = payload.data?.state || ''
          if (instName && connState) {
            useInstanceStore.getState().updateInstanceState(instName, connState as any)
            if (connState === 'open') {
              useUIStore.getState().addToast('"' + instName + '" conectado!')
            }
          }
        }

        if (event === 'chat.update') {
          const d = payload.data || {}
          const jid = d.remoteJid
          if (!jid || d.fromMe) return
          const chat = state.allChats.find((c) => c.id === jid || c.messageJid === jid)
          if (chat && chat.id !== state.selectedChat?.id) {
            const ts = d.messageTimestamp || 0
            if (ts > (state.chatLastSeen[chat.id] || 0)) {
              useChatStore.getState().updateChatFromSSE(chat.id, {
                unreadCount: Math.max(chat.unreadCount, 1),
              })
            }
            if (ts) useChatStore.getState().updateGroupLastMsg(chat.id, ts)
          }
        }
      } catch (err) {
        console.error('[SSE]', err)
      }
    })

    es.onerror = () => {
      useInstanceStore.getState().setSseConnected(false)
      if (es.readyState === EventSource.CLOSED) {
        setTimeout(() => {
          // Reconnect handled by new EventSource on next mount
        }, 5000)
      }
    }

    return () => es.close()
  }, [])
}
