export function isGroupJid(jid: string) {
  return jid?.endsWith('@g.us')
}

export function isPrivateJid(jid: string) {
  return jid?.endsWith('@s.whatsapp.net')
}

export function isRealPhone(num: string) {
  if (!num || num.length > 15) return false
  return /^\d{10,13}$/.test(num)
}

export function phoneKey(phone: string) {
  return phone.slice(-8)
}

export function formatPhone(num: string): string {
  if (!num) return ''
  const d = num.replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) {
    const ddd = d.slice(2, 4)
    const rest = d.slice(4)
    if (rest.length === 9) return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`
    if (rest.length === 8) return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`
  }
  return '+' + d
}
