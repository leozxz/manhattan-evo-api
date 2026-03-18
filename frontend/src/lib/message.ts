import type { Message } from '../types'

export function getMessageText(m: Message): string {
  const msg = m.message
  if (!msg) return ''
  return msg.conversation
    || msg.extendedTextMessage?.text
    || msg.buttonsResponseMessage?.selectedDisplayText
    || msg.listResponseMessage?.title
    || msg.templateButtonReplyMessage?.selectedDisplayText
    || ''
}

export function getMediaType(m: Message): string | null {
  const msg = m.message
  if (!msg) return null
  if (msg.imageMessage) return 'image'
  if (msg.videoMessage) return 'video'
  if (msg.audioMessage) return 'audio'
  if (msg.documentMessage) return 'document'
  if (msg.stickerMessage) return 'sticker'
  if (msg.locationMessage || msg.liveLocationMessage) return 'location'
  if (msg.contactMessage || msg.contactsArrayMessage) return 'contact'
  return null
}

export function getMediaCaption(m: Message): string {
  const msg = m.message
  if (!msg) return ''
  return msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption || ''
}

export function getMessagePreview(msg: Record<string, any>): string {
  return msg.conversation
    || msg.extendedTextMessage?.text
    || (msg.imageMessage ? '📷 Imagem' : '')
    || (msg.videoMessage ? '🎬 Video' : '')
    || (msg.audioMessage ? '🎵 Audio' : '')
    || (msg.documentMessage ? '📄 Documento' : '')
    || (msg.stickerMessage ? '🏷 Sticker' : '')
    || (msg.locationMessage || msg.liveLocationMessage ? '📍 Localizacao' : '')
    || (msg.contactMessage || msg.contactsArrayMessage ? '👤 Contato' : '')
    || ''
}

export function extractMessages(data: any): Message[] {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (data.messages?.records) return data.messages.records
  if (data.messages && Array.isArray(data.messages)) return data.messages
  if (Array.isArray(data.records)) return data.records
  return []
}

export function getTimestamp(m: Message): number {
  const ts = m.messageTimestamp
  return typeof ts === 'string' ? parseInt(ts) : (ts || 0)
}

export const MEDIA_ICONS: Record<string, string> = {
  image: '📷', video: '🎬', audio: '🎵', document: '📄',
  sticker: '🏷', location: '📍', contact: '👤',
}
