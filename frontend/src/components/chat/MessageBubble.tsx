import type { Message } from '../../types'
import { getMessageText, getMediaType, getMediaCaption, MEDIA_ICONS, getTimestamp } from '../../lib/message'
import { useChatStore } from '../../stores/chatStore'
import { formatPhone } from '../../lib/phone'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const contactNames = useChatStore((s) => s.contactNames)
  const setReplyingTo = useChatStore((s) => s.setReplyingTo)
  const fromMe = message.key?.fromMe
  const text = getMessageText(message)
  const mediaType = getMediaType(message)
  const caption = getMediaCaption(message)
  const ts = getTimestamp(message)

  const time = ts
    ? new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : ''

  // Sender name for group messages
  const participant = message.key?.participant
  const senderName = fromMe
    ? ''
    : participant
      ? contactNames[participant] || formatPhone(participant.split('@')[0])
      : message.pushName || ''

  // Quoted message
  const ctx = message.message?.extendedTextMessage?.contextInfo
  const quotedText = ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text || ''

  return (
    <div className={`flex mb-1 ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[65%] rounded-xl px-3 py-1.5 shadow-sm relative group ${
          fromMe ? 'bg-[var(--color-msg-out)] rounded-tr-sm' : 'bg-[var(--color-msg-in)] rounded-tl-sm'
        }`}
      >
        {/* Reply button */}
        <button
          onClick={() => setReplyingTo(message)}
          className="absolute -top-2 right-1 opacity-0 group-hover:opacity-100 transition bg-white rounded-full shadow p-1"
          title="Responder"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[var(--color-text-muted)]">
            <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />
          </svg>
        </button>

        {/* Sender */}
        {senderName && !fromMe && (
          <div className="text-[11px] font-semibold text-[var(--color-accent)] mb-0.5 truncate">{senderName}</div>
        )}

        {/* Quoted */}
        {quotedText && (
          <div className="bg-black/5 rounded-lg px-2 py-1 mb-1 border-l-3 border-[var(--color-accent)]">
            <div className="text-[11px] text-[var(--color-text-secondary)] line-clamp-2">{quotedText}</div>
          </div>
        )}

        {/* Media */}
        {mediaType && (
          <div className="text-sm text-[var(--color-text-secondary)] mb-1">
            {MEDIA_ICONS[mediaType] || '📎'} {mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}
          </div>
        )}

        {/* Text */}
        {text && <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{text}</div>}
        {caption && !text && <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{caption}</div>}

        {/* Time */}
        <div className="flex justify-end mt-0.5">
          <span className="text-[10px] text-[var(--color-text-muted)]">{time}</span>
        </div>
      </div>
    </div>
  )
}
