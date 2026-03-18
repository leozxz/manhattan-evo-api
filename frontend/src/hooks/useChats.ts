import { useQuery } from '@tanstack/react-query'
import { findChats, fetchAllGroups } from '../api/chat'
import { useChatStore } from '../stores/chatStore'
import { useInstanceStore } from '../stores/instanceStore'
import { isGroupJid, isPrivateJid, isRealPhone, phoneKey, formatPhone } from '../lib/phone'
import { getMessagePreview } from '../lib/message'
import type { Chat } from '../types'

export function useChats() {
  const currentInstance = useInstanceStore((s) => s.currentInstance)
  const { setChats, contactNames, setContactName, setLidToPhone, chatLastSeen, groupLastMsg, deletedChats } = useChatStore()

  return useQuery({
    queryKey: ['chats', currentInstance],
    queryFn: async () => {
      if (!currentInstance) return []

      const [chatsRes, groupsRes] = await Promise.all([
        findChats(currentInstance),
        fetchAllGroups(currentInstance, true),
      ])

      const groupMeta: Record<string, any> = {}
      if (groupsRes.ok && Array.isArray(groupsRes.data)) {
        groupsRes.data.forEach((g: any) => {
          groupMeta[g.id] = g
          if (Array.isArray(g.participants)) {
            g._participantNames = g.participants
              .map((p: any) => {
                if (typeof p === 'string') {
                  const phone = p.split('@')[0]
                  return contactNames[p] || (isRealPhone(phone) ? formatPhone(phone) : '')
                }
                const jid = p.id || ''
                const phoneJid = p.phoneNumber ? String(p.phoneNumber) : ''
                const phone = phoneJid ? phoneJid.split('@')[0] : jid.split('@')[0]
                if (jid.endsWith('@lid') && phoneJid) setLidToPhone(jid, phoneJid)
                const name = p.pushName || p.name || p.notify || p.verifiedName || ''
                if (name && !contactNames[jid]) setContactName(jid, name)
                if (name && phoneJid && !contactNames[phoneJid]) setContactName(phoneJid, name)
                return name || contactNames[jid] || contactNames[phoneJid] || (isRealPhone(phone) ? formatPhone(phone) : '')
              })
              .filter(Boolean)
              .slice(0, 5)
          }
        })
      }

      const chatData = chatsRes.ok && Array.isArray(chatsRes.data) ? chatsRes.data : []
      const chatMap: Record<string, Chat> = {}
      const seenPhones: Record<string, string> = {}

      chatData.forEach((c: any) => {
        const jid = c.remoteJid
        if (!jid || jid === 'status@broadcast' || jid === '0@s.whatsapp.net') return
        if (deletedChats[jid]) return

        const lastTs = c.lastMessage?.messageTimestamp || 0
        const gm = groupMeta[jid]
        const isGroup = isGroupJid(jid)
        const isLid = jid.endsWith('@lid')

        let resolvedName = c.pushName || ''
        if (!resolvedName && c.lastMessage?.pushName && !c.lastMessage.key?.fromMe) {
          resolvedName = c.lastMessage.pushName
        }

        let phone = ''
        if (isPrivateJid(jid)) phone = jid.split('@')[0]
        else if (isLid && c.lastMessage?.key) {
          const alt = c.lastMessage.key.remoteJidAlt || c.lastMessage.key.participantAlt || ''
          if (alt?.includes('@s.whatsapp.net')) phone = alt.split('@')[0]
        }

        if (!isGroup && phone) {
          const pk = phoneKey(phone)
          if (seenPhones[pk]) {
            if (isPrivateJid(jid) && !isPrivateJid(seenPhones[pk])) {
              delete chatMap[seenPhones[pk]]
            } else return
          }
          seenPhones[pk] = jid
        }

        const msgTs = typeof lastTs === 'string' ? parseInt(lastTs) : lastTs
        const lastSeen = chatLastSeen[jid] || 0
        let unread = 0
        if (lastSeen >= msgTs) unread = 0
        else if (c.unreadCount > 0) unread = c.unreadCount
        else if (msgTs > 0 && !isGroup && c.lastMessage && !c.lastMessage.key?.fromMe) unread = 1

        let lastMsgPreview = ''
        if (c.lastMessage?.message) {
          lastMsgPreview = getMessagePreview(c.lastMessage.message)
          if (lastMsgPreview.length > 80) lastMsgPreview = lastMsgPreview.substring(0, 80) + '...'
        }

        chatMap[jid] = {
          id: jid, messageJid: jid, isGroup, subject: gm?.subject || resolvedName || '',
          pushName: resolvedName, phone, size: gm?.size || 0,
          profilePicUrl: c.profilePicUrl || null, lastMessageTs: msgTs, unreadCount: unread,
          lastMsgPreview, lastMsgFromMe: !!c.lastMessage?.key?.fromMe,
          participantNames: gm?._participantNames || [],
        }

        if (resolvedName && !contactNames[jid]) setContactName(jid, resolvedName)
      })

      // Include groups not in findChats
      Object.values(groupMeta).forEach((g: any) => {
        if (!chatMap[g.id]) {
          chatMap[g.id] = {
            id: g.id, messageJid: g.id, isGroup: true, subject: g.subject || '',
            pushName: '', phone: '', size: g.size || 0, profilePicUrl: null,
            lastMessageTs: groupLastMsg[g.id] || 0, unreadCount: 0,
            lastMsgPreview: '', lastMsgFromMe: false, participantNames: g._participantNames || [],
          }
        }
      })

      const chats = Object.values(chatMap)
      setChats(chats)
      return chats
    },
    enabled: !!currentInstance,
    refetchInterval: 30000,
  })
}
