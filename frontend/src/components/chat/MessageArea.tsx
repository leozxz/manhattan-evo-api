import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useMessages } from '../../hooks/useMessages'
import { Avatar } from '../common/Avatar'
import { Spinner } from '../common/Spinner'
import { MessageBubble } from './MessageBubble'
import { MessageInput } from './MessageInput'
import { formatPhone } from '../../lib/phone'
import { getTimestamp } from '../../lib/message'

export function MessageArea() {
  const selectedChat = useChatStore((s) => s.selectedChat)
  const contactNames = useChatStore((s) => s.contactNames)
  const { data: messages, isLoading } = useMessages()
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [messages, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60)
  }

  if (!selectedChat) return null

  const displayName = selectedChat.isGroup
    ? selectedChat.subject
    : formatPhone(selectedChat.phone || selectedChat.id.split('@')[0])

  let subtitle = ''
  if (selectedChat.isGroup) {
    subtitle = selectedChat.participantNames.length > 0
      ? selectedChat.participantNames.join(', ') + (selectedChat.size > selectedChat.participantNames.length ? ', +' + (selectedChat.size - selectedChat.participantNames.length) : '')
      : (selectedChat.size || '') + (selectedChat.size ? ' participantes' : '')
  } else {
    subtitle = selectedChat.pushName || contactNames[selectedChat.id] || ''
  }

  // Group messages by day
  let lastDate = ''

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Header */}
      <div className="h-14 bg-[var(--color-panel)] border-b border-[var(--color-border)] flex items-center px-4 gap-3 flex-shrink-0">
        <Avatar src={selectedChat.profilePicUrl} isGroup={selectedChat.isGroup} size="w-9 h-9" />
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{displayName}</div>
          {subtitle && <div className="text-[11px] text-[var(--color-text-muted)] truncate max-w-[350px]">{subtitle}</div>}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-[11px] text-[var(--color-accent)]">
          <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
          ao vivo
        </div>
      </div>

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading && (
          <div className="flex justify-center py-8"><Spinner /></div>
        )}
        {messages?.map((msg) => {
          const ts = getTimestamp(msg)
          const date = ts ? new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleDateString('pt-BR') : ''
          let daySep = null
          if (date && date !== lastDate) {
            lastDate = date
            daySep = (
              <div key={'day-' + date} className="flex justify-center my-3">
                <span className="bg-white/80 text-[var(--color-text-muted)] text-[11px] px-3 py-1 rounded-lg shadow-sm">
                  {date}
                </span>
              </div>
            )
          }
          return (
            <div key={msg.key?.id || ts}>
              {daySep}
              <MessageBubble message={msg} />
            </div>
          )
        })}
      </div>

      {/* Input */}
      <MessageInput />
    </div>
  )
}
