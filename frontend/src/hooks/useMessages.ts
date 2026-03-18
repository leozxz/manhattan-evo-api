import { useQuery } from '@tanstack/react-query'
import { findMessages } from '../api/chat'
import { useInstanceStore } from '../stores/instanceStore'
import { useChatStore } from '../stores/chatStore'
import { extractMessages, getTimestamp } from '../lib/message'
import type { Message } from '../types'

export function useMessages() {
  const currentInstance = useInstanceStore((s) => s.currentInstance)
  const selectedChat = useChatStore((s) => s.selectedChat)

  return useQuery({
    queryKey: ['messages', currentInstance, selectedChat?.id],
    queryFn: async (): Promise<Message[]> => {
      if (!currentInstance || !selectedChat) return []

      const jidsToTry = [selectedChat.id]
      if (selectedChat.messageJid && selectedChat.messageJid !== selectedChat.id) {
        jidsToTry.push(selectedChat.messageJid)
      }
      if (selectedChat.phone) {
        const pJid = selectedChat.phone + '@s.whatsapp.net'
        if (!jidsToTry.includes(pJid)) jidsToTry.push(pJid)
        // BR 9-digit variants
        const phone = selectedChat.phone
        if (phone.startsWith('55') && phone.length === 13)
          jidsToTry.push(phone.slice(0, 4) + phone.slice(5) + '@s.whatsapp.net')
        else if (phone.startsWith('55') && phone.length === 12)
          jidsToTry.push(phone.slice(0, 4) + '9' + phone.slice(4) + '@s.whatsapp.net')
      }

      const dedupIds = new Set<string>()
      const allMsgs: Message[] = []

      for (const jid of jidsToTry) {
        const r = await findMessages(currentInstance, jid)
        const msgs = extractMessages(r.ok ? r.data : null)
        msgs.forEach((m: Message) => {
          const mid = m.key?.id
          if (mid && !dedupIds.has(mid)) {
            dedupIds.add(mid)
            allMsgs.push(m)
          }
        })
      }

      allMsgs.sort((a, b) => getTimestamp(a) - getTimestamp(b))
      return allMsgs
    },
    enabled: !!currentInstance && !!selectedChat,
    refetchInterval: 3000,
  })
}
