import { api } from './client'

export async function fetchInstances() {
  const res = await api('GET', '/instance/fetchInstances')
  return res.ok && Array.isArray(res.data) ? res.data : []
}

export async function connectInstance(name: string) {
  return api('GET', '/instance/connect/' + name)
}

export async function restartInstance(name: string) {
  return api('PUT', '/instance/restart/' + name)
}

export async function logoutInstance(name: string) {
  return api('DELETE', '/instance/logout/' + name)
}

export async function deleteInstance(name: string) {
  return api('DELETE', '/instance/delete/' + name)
}

export async function createInstance(name: string, webhookUrl?: string) {
  const body: any = { instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, rejectCall: false }
  if (webhookUrl) {
    body.webhook = {
      enabled: true, url: webhookUrl, byEvents: false,
      events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'GROUPS_UPSERT', 'GROUP_PARTICIPANTS_UPDATE', 'PRESENCE_UPDATE'],
    }
  }
  return api('POST', '/instance/create', body)
}
