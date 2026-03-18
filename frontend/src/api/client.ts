export interface ApiResponse<T = any> {
  ok: boolean
  status: number
  data: T | null
}

export async function api<T = any>(method: string, path: string, body?: any): Promise<ApiResponse<T>> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  try {
    const r = await fetch(path, opts)
    const data = await r.json().catch(() => null)
    if (!r.ok) return { ok: false, status: r.status, data }
    return { ok: true, status: r.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}
