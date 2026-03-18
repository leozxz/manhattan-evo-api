import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendText, sendPresence, aiSuggest } from '../../api/chat'
import { useInstanceStore } from '../../stores/instanceStore'
import { useChatStore } from '../../stores/chatStore'
import { useUIStore } from '../../stores/uiStore'
import { getMessageText } from '../../lib/message'
import { useMessages } from '../../hooks/useMessages'

export function MessageInput() {
  const [text, setText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentInstance = useInstanceStore((s) => s.currentInstance)
  const { selectedChat, replyingTo, setReplyingTo } = useChatStore()
  const addToast = useUIStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const { data: messages } = useMessages()

  const sendNumber = selectedChat?.isGroup
    ? selectedChat?.id
    : selectedChat?.phone || selectedChat?.id?.split('@')[0] || ''

  const sendMutation = useMutation({
    mutationFn: async (msgText: string) => {
      if (!currentInstance || !sendNumber) throw new Error('Not connected')

      // Composing presence
      await sendPresence(currentInstance, sendNumber, 'composing')
      await new Promise((r) => setTimeout(r, Math.random() * 2000 + 1000))

      const body: any = { number: sendNumber, text: msgText }
      if (replyingTo?.key) {
        body.quoted = {
          key: { id: replyingTo.key.id, remoteJid: replyingTo.key.remoteJid, fromMe: replyingTo.key.fromMe },
          message: replyingTo.message,
        }
        if (replyingTo.key.participant) body.quoted.key.participant = replyingTo.key.participant
      }

      const res = await sendText(currentInstance, body)
      await sendPresence(currentInstance, sendNumber, 'paused')
      if (!res.ok) throw new Error('Send failed')
      return res
    },
    onSuccess: () => {
      setReplyingTo(null)
      queryClient.invalidateQueries({ queryKey: ['messages'] })
    },
    onError: () => addToast('Erro ao enviar mensagem', 'error'),
  })

  const handleSend = () => {
    const msg = text.trim()
    if (!msg) return
    setText('')
    sendMutation.mutate(msg)
  }

  const handleAiSuggest = async () => {
    if (aiLoading || !messages?.length) return
    setAiLoading(true)
    try {
      const textMsgs = messages
        .map((m) => ({ text: getMessageText(m), fromMe: !!m.key?.fromMe }))
        .filter((m) => m.text)
        .slice(-15)

      if (textMsgs.length === 0) { addToast('Nenhuma mensagem de texto', 'error'); return }

      const res = await aiSuggest(textMsgs)
      if (res.ok && res.data?.suggestion) {
        setText(res.data.suggestion)
        inputRef.current?.focus()
        addToast('Sugestao gerada pela IA')
      } else {
        addToast('Erro ao gerar sugestao', 'error')
      }
    } catch {
      addToast('Erro ao conectar com IA', 'error')
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div className="bg-[var(--color-panel)] border-t border-[var(--color-border)] px-4 py-3">
      {/* Reply preview */}
      {replyingTo && (
        <div className="flex items-center gap-2 mb-2 bg-[var(--color-panel-alt)] rounded-lg px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-[var(--color-accent)]">
              {replyingTo.key?.fromMe ? 'Voce' : replyingTo.pushName || ''}
            </div>
            <div className="text-xs text-[var(--color-text-muted)] truncate">
              {getMessageText(replyingTo) || 'Midia'}
            </div>
          </div>
          <button onClick={() => setReplyingTo(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            &times;
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* AI Suggest */}
        <button
          onClick={handleAiSuggest}
          disabled={aiLoading}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-purple-500/10 transition relative overflow-hidden"
          title="Sugestao IA"
        >
          {aiLoading ? (
            <div className="w-4 h-4 border-2 border-purple-200 border-t-purple-500 rounded-full animate-spin" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" className="fill-[var(--color-text-muted)] hover:fill-purple-500 transition">
              <path d="M10 2L8.6 6.6 4 8l4.6 1.4L10 14l1.4-4.6L16 8l-4.6-1.4L10 2zm8 6l-1 3-3 1 3 1 1 3 1-3 3-1-3-1-1-3zm-4 8l-1.5 4.5L8 22l-1.5-1.5L2 19l4.5-1.5L8 13l1.5 4.5z" />
            </svg>
          )}
        </button>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Digite uma mensagem..."
          className="flex-1 px-4 py-2.5 bg-[var(--color-panel-alt)] rounded-full text-sm outline-none border border-transparent focus:border-[var(--color-accent)]"
        />

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMutation.isPending}
          className="w-10 h-10 rounded-full bg-[var(--color-accent)] flex items-center justify-center hover:bg-[var(--color-accent-hover)] transition disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" className="fill-white">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
