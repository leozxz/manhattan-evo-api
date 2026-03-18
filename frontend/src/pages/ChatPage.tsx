import { useChatStore } from '../stores/chatStore'
import { ChatList } from '../components/chat/ChatList'
import { MessageArea } from '../components/chat/MessageArea'

export function ChatPage() {
  const selectedChat = useChatStore((s) => s.selectedChat)

  return (
    <div className="flex h-full overflow-hidden">
      <ChatList />
      {selectedChat ? (
        <MessageArea />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--color-panel-alt)]">
          <div className="text-center text-[var(--color-text-muted)]">
            <svg viewBox="0 0 24 24" className="w-16 h-16 mx-auto mb-4 fill-[var(--color-border)]">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
            </svg>
            <p className="text-sm">Selecione uma conversa</p>
          </div>
        </div>
      )}
    </div>
  )
}
