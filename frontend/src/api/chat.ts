import { api } from './client'

export async function findChats(instance: string) {
  return api('POST', '/chat/findChats/' + instance, {})
}

export async function findMessages(instance: string, remoteJid: string) {
  return api('POST', '/chat/findMessages/' + instance, {
    where: { key: { remoteJid } }, offset: 100, page: 1,
  })
}

export async function sendText(instance: string, body: { number: string; text: string; mentioned?: string[]; everyOne?: boolean; quoted?: any }) {
  return api('POST', '/message/sendText/' + instance, body)
}

export async function sendMedia(instance: string, body: any) {
  return api('POST', '/message/sendMedia/' + instance, body)
}

export async function sendWhatsAppAudio(instance: string, body: { number: string; audio: string }) {
  return api('POST', '/message/sendWhatsAppAudio/' + instance, body)
}

export async function sendPresence(instance: string, number: string, presence: string) {
  const delay = Math.floor(Math.random() * 2000) + 1000
  return api('POST', '/chat/sendPresence/' + instance, { number, presence, delay })
}

export async function sendReaction(instance: string, body: any) {
  return api('PUT', '/message/sendReaction/' + instance, body)
}

export async function findContacts(instance: string) {
  return api('POST', '/chat/findContacts/' + instance, {})
}

export async function whatsappNumbers(instance: string, numbers: string[]) {
  return api('POST', '/chat/whatsappNumbers/' + instance, { numbers })
}

export async function fetchAllGroups(instance: string, getParticipants = true) {
  return api('GET', '/group/fetchAllGroups/' + instance + '?getParticipants=' + getParticipants)
}

export async function fetchParticipants(instance: string, groupJid: string) {
  return api('GET', '/group/participants/' + instance + '?groupJid=' + encodeURIComponent(groupJid))
}

export async function getBase64Media(instance: string, msgId: string, convertToMp4: boolean) {
  return api('POST', '/chat/getBase64FromMediaMessage/' + instance, {
    message: { key: { id: msgId } }, convertToMp4,
  })
}

export async function fetchConfig() {
  const res = await api<{ webhookUrl: string }>('GET', '/config')
  return res.ok ? res.data?.webhookUrl || '' : ''
}

export async function setWebhook(instance: string, webhookUrl: string) {
  return api('POST', '/webhook/set/' + instance, {
    webhook: {
      enabled: true, url: webhookUrl, byEvents: false,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'GROUP_PARTICIPANTS_UPDATE', 'CHATS_UPDATE', 'CHATS_UPSERT', 'PRESENCE_UPDATE'],
    },
  })
}

export async function aiSuggest(messages: { text: string; fromMe: boolean }[]) {
  return api<{ suggestion: string }>('POST', '/ai/suggest', { messages })
}
