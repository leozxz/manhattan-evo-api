import { useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useChats } from '../../hooks/useChats'
import { Avatar } from '../common/Avatar'
import { Spinner } from '../common/Spinner'
import { formatPhone } from '../../lib/phone'
import type { Chat, ChatFilter } from '../../types'

const filters: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'groups', label: 'Grupos' },
  { key: 'private', label: 'Privadas' },
]

export function ChatList() {
  const { isLoading } = useChats()
  const { allChats, selectedChat, chatFilter, setChatFilter, selectChat, groupLastMsg, contactNames } = useChatStore()
  const [search, setSearch] = useState('')

  let filtered = allChats
  if (chatFilter === 'groups') filtered = allChats.filter((c) => c.isGroup)
  else if (chatFilter === 'private') filtered = allChats.filter((c) => !c.isGroup)

  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter((c) => {
      const name = c.isGroup ? c.subject : (c.pushName || contactNames[c.id] || c.phone || '')
      return name.toLowerCase().includes(q) || c.phone?.includes(q) || c.id.includes(q)
    })
  }

  const sorted = [...filtered].sort((a, b) => {
    const tsA = groupLastMsg[a.id] || a.lastMessageTs || 0
    const tsB = groupLastMsg[b.id] || b.lastMessageTs || 0
    if (tsA !== tsB) return tsB - tsA
    return (a.subject || a.pushName || '').localeCompare(b.subject || b.pushName || '')
  })

  return (
    <div className="w-[340px] bg-[var(--color-panel)] border-r border-[var(--color-border)] flex flex-col flex-shrink-0">
      {/* Search */}
      <div className="p-3">
        <input
          type="text"
          placeholder="Buscar conversa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-[var(--color-panel-alt)] rounded-lg text-sm outline-none border border-transparent focus:border-[var(--color-accent)]"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-[var(--color-border)]">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setChatFilter(f.key)}
            className={`flex-1 py-2 text-xs font-semibold transition ${
              chatFilter === f.key
                ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex justify-center py-8"><Spinner /></div>
        )}
        {sorted.map((chat) => (
          <ChatItem key={chat.id} chat={chat} isActive={selectedChat?.id === chat.id} onClick={() => selectChat(chat)} />
        ))}
        {!isLoading && sorted.length === 0 && (
          <div className="text-center text-[var(--color-text-muted)] text-sm py-8">Nenhuma conversa</div>
        )}
      </div>
    </div>
  )
}

function ChatItem({ chat, isActive, onClick }: { chat: Chat; isActive: boolean; onClick: () => void }) {
  const groupLastMsg = useChatStore((s) => s.groupLastMsg)
  const contactNames = useChatStore((s) => s.contactNames)

  const displayName = chat.isGroup
    ? chat.subject || chat.id
    : formatPhone(chat.phone || chat.id.split('@')[0])

  let subtitle = ''
  if (chat.lastMsgPreview) {
    subtitle = (chat.lastMsgFromMe ? 'Voce: ' : '') + chat.lastMsgPreview
  } else if (chat.isGroup) {
    subtitle = chat.participantNames.length > 0
      ? chat.participantNames.join(', ') + (chat.size > chat.participantNames.length ? ', +' + (chat.size - chat.participantNames.length) : '')
      : (chat.size || '?') + ' participantes'
  } else {
    subtitle = chat.pushName || contactNames[chat.id] || ''
  }

  const lastTs = groupLastMsg[chat.id] || chat.lastMessageTs
  const timeStr = lastTs
    ? new Date(lastTs < 1e12 ? lastTs * 1000 : lastTs).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
        isActive ? 'bg-[var(--color-accent-light)]' : 'hover:bg-[var(--color-panel-alt)]'
      }`}
    >
      <Avatar src={chat.profilePicUrl} isGroup={chat.isGroup} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate ${chat.unreadCount > 0 ? 'font-bold' : 'font-semibold'}`}>
          {displayName}
        </div>
        {subtitle && (
          <div className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">{subtitle}</div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {timeStr && (
          <span className={`text-[11px] ${chat.unreadCount > 0 ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-muted)]'}`}>
            {timeStr}
          </span>
        )}
        {chat.unreadCount > 0 && (
          <span className="bg-[var(--color-accent)] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {chat.unreadCount}
          </span>
        )}
      </div>
    </div>
  )
}
