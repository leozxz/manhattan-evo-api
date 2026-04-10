# Manhattan API Documentation

## Overview

Manhattan is a WhatsApp CRM built on top of Evolution API. This document covers all endpoints, authentication, webhooks, and integration patterns.

**Base URL:** `http://localhost:3000` (or your deployment URL)

---

## Authentication

### Session-Based Auth (Cookie)

All API endpoints (except `/health`, `/auth/*`, and `/webhook/internal`) require authentication via session cookie.

**Login Flow:**

```
1. POST /auth/login  (username + password)
2. POST /auth/verify  (2FA code via WhatsApp)
3. Session cookie set automatically
```

**Session Details:**
- Cookie name: `session`
- HttpOnly, SameSite=Strict
- TTL: 24 hours
- Storage: Redis (or in-memory fallback)

### Auth Endpoints

#### `POST /auth/login`
Step 1: Password authentication.

| Field | Type | Required |
|-------|------|----------|
| user | string | Yes |
| pass | string | Yes |

Content-Type: `application/x-www-form-urlencoded`

Returns HTML with 2FA form if phone configured, or sets session directly.

#### `POST /auth/verify`
Step 2: Verify 2FA code.

| Field | Type | Required |
|-------|------|----------|
| token | string | Yes |
| code | string (6 digits) | Yes |

Redirects to `/` with session cookie on success.

#### `POST /auth/resend`
Resend 2FA code.

| Field | Type | Required |
|-------|------|----------|
| token | string | Yes |

#### `GET /auth/register`
Display registration form.

#### `POST /auth/register`
Create new user account.

| Field | Type | Required |
|-------|------|----------|
| user | string | Yes |
| email | string | Yes |
| phone | string (with country code) | Yes |
| pass | string | Yes |
| pass2 | string (confirmation) | Yes |

#### `GET /auth/logout`
Destroy session and redirect to login.

---

## Health Check

#### `GET /health`
No auth required.

```json
{"status": "ok"}
```

---

## User Management (Admin Only)

#### `GET /api/users`
List all panel users.

**Response:**
```json
[
  {
    "id": "uuid",
    "username": "admin",
    "name": "Admin User",
    "role": "admin",
    "email": "admin@example.com",
    "active": true,
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
]
```

#### `POST /api/users`
Create or update user (upsert on username).

**Body:**
```json
{
  "username": "john",
  "password": "secret123",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "5511999999999"
}
```

#### `PATCH /api/users/:id/role`
Toggle user role.

**Body:**
```json
{"role": "admin"}
```

#### `GET /api/me`
Get current authenticated user.

**Response:**
```json
{"userId": "uuid", "username": "admin", "role": "admin"}
```

---

## AI Endpoints

All AI endpoints require `OPENAI_API_KEY` environment variable.

**Rate Limit:** 120 requests/minute per IP.

#### `POST /ai/suggest`
Generate a suggested response for a conversation.

**Body:**
```json
{
  "messages": [
    {"fromMe": false, "text": "Oi, tudo bem?"},
    {"fromMe": true, "text": "Tudo otimo!"},
    {"fromMe": false, "text": "Preciso de uma cotacao"}
  ]
}
```

**Response:**
```json
{"suggestion": "Claro! Qual produto voce precisa cotar?"}
```

Model: gpt-4o-mini | Temperature: 0.7 | Max tokens: 200

#### `POST /ai/graph-query`
Query the knowledge graph with natural language.

**Body:**
```json
{
  "question": "Onde o cliente trabalha?",
  "entities": [{"category": "TRABALHO", "label": "Empresa X", "value": "Gerente"}],
  "summary": "Cliente e gerente na Empresa X..."
}
```

**Response:**
```json
{
  "answer": "O cliente trabalha na Empresa X como Gerente.",
  "found": true,
  "matchLabels": ["Empresa X"],
  "suggestedMessage": "Sobre seu trabalho na Empresa X..."
}
```

Model: gpt-4o-mini | Temperature: 0.3 | JSON mode

#### `POST /ai/search`
Search across all conversations with AI.

**Body (max 512KB):**
```json
{
  "question": "Quem me pediu cotacao hoje?",
  "messages": [{"id": "0", "contact": "Leonardo", "text": "preciso da cotacao", "fromMe": false, "timestamp": 1712700000}],
  "contacts": ["Leonardo", "Maria"],
  "messageLines": "[0] (hoje 14:30) Leonardo: preciso da cotacao"
}
```

**Response:**
```json
{
  "results": [
    {"id": "0", "contact": "Leonardo", "reason": "Pediu cotacao diretamente"}
  ],
  "summary": "Leonardo pediu uma cotacao hoje as 14:30."
}
```

Model: gpt-4o-mini | Temperature: 0.2 | JSON mode

---

## Knowledge Graph

All endpoints follow: `/knowledge/{action}/{instanceName}?params`

**Rate Limit:** 120 requests/minute per IP.

**Note:** Knowledge data is instance-independent. The `instanceName` in the URL is used for message extraction but data is stored per contact (remoteJid), not per instance.

#### `GET /knowledge/contacts/{instanceName}`
List all contacts with knowledge data.

**Response:**
```json
[
  {
    "id": "uuid",
    "remoteJid": "5511999999999@s.whatsapp.net",
    "pushName": "Leonardo",
    "savedName": "Leonardo Andrade",
    "summary": "Cliente interessado em investimentos...",
    "entityCount": 12,
    "relationshipCount": 3
  }
]
```

#### `GET /knowledge/contact/{instanceName}?remoteJid={jid}`
Get full knowledge profile for a contact.

**Response:**
```json
{
  "id": "uuid",
  "remoteJid": "5511999999999@s.whatsapp.net",
  "pushName": "Leonardo",
  "summary": "...",
  "entities": [
    {"id": "uuid", "category": "TRABALHO", "label": "Empresa X", "value": "Gerente", "confidence": 0.95}
  ],
  "relationships": [
    {
      "type": "trabalha_em",
      "fromEntity": {"label": "Leonardo", "category": "PESSOA"},
      "toEntity": {"label": "Empresa X", "category": "TRABALHO"}
    }
  ]
}
```

**Entity Categories:** PESSOA, FAMILIA, FINANCEIRO, SAUDE, MORADIA, TRABALHO, EDUCACAO, INTERESSE, EVENTO, SENTIMENTO

#### `POST /knowledge/extract/{instanceName}`
Extract knowledge from recent messages.

**Body:**
```json
{"remoteJid": "5511999999999@s.whatsapp.net", "messageCount": 50}
```

Returns full contact knowledge object (same as GET).

#### `DELETE /knowledge/contact/{instanceName}?remoteJid={jid}`
Delete all knowledge for a contact.

#### `GET /knowledge/tasks/{instanceName}?remoteJid={jid}`
Get active tasks for a contact (excludes completed/rejected).

#### `POST /knowledge/tasks/{instanceName}`
AI-extract new tasks from conversation.

**Body:**
```json
{"remoteJid": "5511999999999@s.whatsapp.net"}
```

#### `PUT /knowledge/task/{instanceName}`
Update a task.

**Body:**
```json
{"taskId": "uuid", "status": "concluida", "priority": "alta"}
```

Status values: `pendente`, `em_andamento`, `concluida`, `recusada`
Priority values: `alta`, `media`, `baixa`

#### `DELETE /knowledge/task/{instanceName}?taskId={uuid}`
Delete a task.

#### `PUT /knowledge/contact-name/{instanceName}`
Save custom name for a contact.

**Body:**
```json
{"remoteJid": "5511999999999@s.whatsapp.net", "name": "Leonardo Andrade"}
```

#### `GET /knowledge/saved-contacts/{instanceName}`
List contacts with saved custom names.

---

## Message Queue (Scheduled Messages)

#### `POST /queue/schedule`
Schedule a message to be sent later.

**Body:**
```json
{
  "instance": "WhatsApp-1",
  "number": "5511999999999",
  "text": "Lembrete: reuniao amanha",
  "sendAt": 1712786400
}
```

`sendAt` is a Unix timestamp (seconds). Queue processor runs every 5 seconds.

#### `GET /queue/status`
Check queue health.

**Response:**
```json
{"queued": 3, "redis": true}
```

---

## Server-Sent Events (SSE)

#### `GET /events`
Open real-time event stream. Requires auth.

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**First event:**
```
event: connected
data: {"status":"ok"}
```

**Subsequent events** (forwarded from webhooks):
```
event: messages.upsert
data: {"event":"messages.upsert","data":{"key":{"remoteJid":"..."},"message":{"conversation":"Hello"}}}
```

**Event types:** `messages.upsert`, `messages.update`, `connection.update`, `group-participants.update`, `chats.update`, `chats.upsert`, `presence.update`

---

## Webhook (Evolution API -> Manhattan)

#### `POST /webhook/internal`
Receives events from Evolution API. No session auth required.

**Security:**
- **HMAC-SHA256 signature** verification via `x-webhook-signature` header (if `WEBHOOK_SECRET` env var is set)
- **Event whitelist:** only allowed event types are accepted (see SSE events above)
- **Rate limit:** 100 requests/second
- Invalid signature -> 401
- Unknown event -> 400
- Rate exceeded -> 429

**Body:**
```json
{
  "event": "MESSAGES_UPSERT",
  "instance": "WhatsApp-1",
  "data": {
    "key": {"remoteJid": "5511999999999@s.whatsapp.net", "fromMe": false, "id": "msg123"},
    "message": {"conversation": "Oi!"},
    "messageTimestamp": 1712700000,
    "pushName": "Leonardo"
  }
}
```

**To enable HMAC verification:** Set `WEBHOOK_SECRET` environment variable. The Evolution API must send `x-webhook-signature: <hmac-sha256-hex>` header with each request.

---

## Evolution API Proxy

All Evolution API calls are proxied through Manhattan with auth and caching.

**Proxy Prefixes:** `/instance/*`, `/message/*`, `/chat/*`, `/group/*`, `/webhook/*`

**Rate Limit:** 120 requests/minute per IP.

**Cached Routes (GET only):**
| Route | TTL |
|-------|-----|
| `/instance/fetchInstances` | 15s |
| `/chat/findContacts/*` | 5min |
| `/group/fetchAllGroups/*` | 2min |

Cache headers: `X-Cache: HIT` or `X-Cache: MISS`

### Common Proxy Calls

```
GET  /instance/fetchInstances         — List all WhatsApp instances
POST /instance/create                 — Create new instance
POST /message/sendText/{instance}     — Send text message
POST /message/sendMedia/{instance}    — Send media (image, video, document)
POST /chat/findChats/{instance}       — List recent chats
POST /chat/findMessages/{instance}    — Get messages for a chat
GET  /group/fetchAllGroups/{instance} — List all groups
POST /group/create/{instance}         — Create group
GET  /group/participants/{instance}   — Get group members
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `EVO_API_URL` | Yes | `http://localhost:8080` | Evolution API base URL |
| `EVO_API_KEY` | Yes | - | Evolution API key |
| `OPENAI_API_KEY` | For AI features | - | OpenAI API key |
| `PORT` | No | `3000` | Server port |
| `REDIS_URL` | No | - | Redis URL (sessions, cache, queue) |
| `WEBHOOK_SECRET` | No | - | HMAC secret for webhook verification |
| `WEBHOOK_URL` | No | `http://localhost:{PORT}/webhook/internal` | Webhook callback URL |
| `ADMIN_PASS` | No | `admin123` | Initial admin password |

---

## Security Headers

All responses include:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; ...
```

## Rate Limiting

- **API endpoints:** 120 req/min per IP (Redis-backed, memory fallback)
- **Webhook:** 100 req/sec (dedicated counter)
- **Response:** HTTP 429 `{"error": "Too many requests"}`
