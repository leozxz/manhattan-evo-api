export interface Instance {
  name: string
  state: 'open' | 'close' | 'connecting' | 'unknown'
  profilePicUrl?: string
  number?: string
}

export interface Chat {
  id: string
  messageJid: string
  isGroup: boolean
  subject: string
  pushName: string
  phone: string
  size: number
  profilePicUrl: string | null
  lastMessageTs: number
  unreadCount: number
  lastMsgPreview: string
  lastMsgFromMe: boolean
  participantNames: string[]
}

export type ChatFilter = 'all' | 'groups' | 'private'

export interface MessageKey {
  id: string
  remoteJid: string
  fromMe: boolean
  participant?: string
}

export interface Message {
  key: MessageKey
  message: Record<string, any>
  messageTimestamp: number | string
  pushName?: string
  status?: string
}

export interface Participant {
  id: string
  phoneNumber?: string
  pushName?: string
  name?: string
  notify?: string
  verifiedName?: string
  admin?: string
}

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

export type Page = 'connect' | 'group' | 'chat' | 'dashboard'
