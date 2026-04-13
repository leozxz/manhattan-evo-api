# Manhattan

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-optional-DC382D?logo=redis&logoColor=white)
![Evolution API](https://img.shields.io/badge/Evolution_API-v2-25D366?logo=whatsapp&logoColor=white)
![License](https://img.shields.io/badge/License-Private-gray)

**WhatsApp CRM** built on top of [Evolution API](https://github.com/EvolutionAPI/evolution-api). Manage conversations, extract knowledge with AI, schedule messages, and monitor events in real time.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-org/manhattan-evo-api.git
cd manhattan-evo-api

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)

# 4. Run
npm start
# Server starts at http://localhost:3000
```

---

## API Reference

**Base URL:** `http://localhost:3000`

All endpoints (except Auth, Health, and Webhook) require an authenticated session cookie.

### Table of Contents

| Section | Endpoints | Auth |
|---------|-----------|------|
| [Health](#health) | 1 | None |
| [Authentication](#authentication) | 6 | None |
| [Users](#user-management) | 4 | Admin |
| [AI](#ai) | 3 | Session |
| [Knowledge Graph](#knowledge-graph) | 11 | Session |
| [Message Queue](#message-queue) | 2 | Session |
| [SSE (Real-time)](#server-sent-events) | 1 | Session |
| [Webhook](#webhook) | 1 | HMAC |
| [Evolution API Proxy](#evolution-api-proxy) | 20+ | Session |

---

### Health

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/health</code> &mdash; Health check</summary>

&nbsp;

> **Auth:** None

**Response `200`**

```json
{ "status": "ok" }
```

</details>

---

### Authentication

Session-based auth with optional 2FA via WhatsApp. Login flow:

```
POST /auth/login  ──▶  password check  ──▶  sends 2FA code via WhatsApp
POST /auth/verify ──▶  validate code   ──▶  session cookie set
```

Session: `HttpOnly` cookie, `SameSite=Strict`, TTL 24h, stored in Redis (memory fallback).

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/auth/login</code> &mdash; Step 1: password authentication</summary>

&nbsp;

> **Auth:** None &nbsp;|&nbsp; **Content-Type:** `application/x-www-form-urlencoded`

**Request body**

| Field | Type | Required |
|-------|------|----------|
| `user` | string | Yes |
| `pass` | string | Yes |

**Response:** HTML with 2FA form if phone configured, or sets session directly.

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/auth/verify</code> &mdash; Step 2: verify 2FA code</summary>

&nbsp;

> **Auth:** None &nbsp;|&nbsp; **Content-Type:** `application/x-www-form-urlencoded`

**Request body**

| Field | Type | Required |
|-------|------|----------|
| `token` | string | Yes |
| `code` | string (6 digits) | Yes |

**Response:** Redirects to `/` with session cookie on success.

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/auth/resend</code> &mdash; Resend 2FA code</summary>

&nbsp;

> **Auth:** None

**Request body**

| Field | Type | Required |
|-------|------|----------|
| `token` | string | Yes |

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/auth/register</code> &mdash; Display registration form</summary>

&nbsp;

> **Auth:** None

**Response:** HTML registration page.

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/auth/register</code> &mdash; Create new user account</summary>

&nbsp;

> **Auth:** None &nbsp;|&nbsp; **Content-Type:** `application/x-www-form-urlencoded`

**Request body**

| Field | Type | Required |
|-------|------|----------|
| `user` | string | Yes |
| `email` | string | Yes |
| `phone` | string (with country code) | Yes |
| `pass` | string | Yes |
| `pass2` | string (confirmation) | Yes |

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/auth/logout</code> &mdash; Destroy session</summary>

&nbsp;

> **Auth:** Session cookie

**Response:** Redirects to login page.

</details>

---

### User Management

> **All endpoints require `admin` role.**

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/api/me</code> &mdash; Current user info</summary>

&nbsp;

> **Auth:** Session

**Response `200`**

```json
{
  "userId": "uuid",
  "username": "admin",
  "role": "admin"
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/api/users</code> &mdash; List all users</summary>

&nbsp;

> **Auth:** Admin session

**Response `200`**

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

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/api/users</code> &mdash; Create or update user</summary>

&nbsp;

> **Auth:** Admin session

**Request body**

```json
{
  "username": "john",
  "password": "secret123",
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "5511999999999"
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/PATCH-purple" alt="PATCH"> <code>/api/users/:id/role</code> &mdash; Toggle user role</summary>

&nbsp;

> **Auth:** Admin session

**Request body**

```json
{ "role": "admin" }
```

Allowed values: `admin`, `user`

</details>

---

### AI

> Requires `OPENAI_API_KEY` environment variable.
>
> **Rate limit:** 120 req/min per IP.

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/ai/suggest</code> &mdash; Generate suggested reply</summary>

&nbsp;

> **Auth:** Session &nbsp;|&nbsp; **Model:** gpt-4o-mini &nbsp;|&nbsp; **Temp:** 0.7 &nbsp;|&nbsp; **Max tokens:** 200

**Request body**

```json
{
  "messages": [
    { "fromMe": false, "text": "Oi, tudo bem?" },
    { "fromMe": true, "text": "Tudo otimo!" },
    { "fromMe": false, "text": "Preciso de uma cotacao" }
  ]
}
```

**Response `200`**

```json
{
  "suggestion": "Claro! Qual produto voce precisa cotar?"
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/ai/graph-query</code> &mdash; Query knowledge graph with natural language</summary>

&nbsp;

> **Auth:** Session &nbsp;|&nbsp; **Model:** gpt-4o-mini &nbsp;|&nbsp; **Temp:** 0.3 &nbsp;|&nbsp; **JSON mode**

**Request body**

```json
{
  "question": "Onde o cliente trabalha?",
  "entities": [
    { "category": "TRABALHO", "label": "Empresa X", "value": "Gerente" }
  ],
  "summary": "Cliente e gerente na Empresa X..."
}
```

**Response `200`**

```json
{
  "answer": "O cliente trabalha na Empresa X como Gerente.",
  "found": true,
  "matchLabels": ["Empresa X"],
  "suggestedMessage": "Sobre seu trabalho na Empresa X..."
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/ai/search</code> &mdash; AI-powered search across conversations</summary>

&nbsp;

> **Auth:** Session &nbsp;|&nbsp; **Model:** gpt-4o-mini &nbsp;|&nbsp; **Temp:** 0.2 &nbsp;|&nbsp; **JSON mode** &nbsp;|&nbsp; **Max body:** 512KB

**Request body**

```json
{
  "question": "Quem me pediu cotacao hoje?",
  "messages": [
    {
      "id": "0",
      "contact": "Leonardo",
      "text": "preciso da cotacao",
      "fromMe": false,
      "timestamp": 1712700000
    }
  ],
  "contacts": ["Leonardo", "Maria"],
  "messageLines": "[0] (hoje 14:30) Leonardo: preciso da cotacao"
}
```

**Response `200`**

```json
{
  "results": [
    { "id": "0", "contact": "Leonardo", "reason": "Pediu cotacao diretamente" }
  ],
  "summary": "Leonardo pediu uma cotacao hoje as 14:30."
}
```

</details>

---

### Knowledge Graph

> All endpoints follow the pattern: `/knowledge/{action}/{instanceName}`
>
> **Rate limit:** 120 req/min per IP.

**Entity Categories:** `PESSOA` `FAMILIA` `FINANCEIRO` `SAUDE` `MORADIA` `TRABALHO` `EDUCACAO` `INTERESSE` `EVENTO` `SENTIMENTO`

**Task Status:** `pendente` `em_andamento` `concluida` `recusada`

**Task Priority:** `alta` `media` `baixa`

#### Contacts & Entities

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/knowledge/contacts/{instanceName}</code> &mdash; List contacts with knowledge data</summary>

&nbsp;

> **Auth:** Session

**Response `200`**

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

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/knowledge/contact/{instanceName}?remoteJid={jid}</code> &mdash; Full contact profile</summary>

&nbsp;

> **Auth:** Session

**Response `200`**

```json
{
  "id": "uuid",
  "remoteJid": "5511999999999@s.whatsapp.net",
  "pushName": "Leonardo",
  "summary": "...",
  "entities": [
    {
      "id": "uuid",
      "category": "TRABALHO",
      "label": "Empresa X",
      "value": "Gerente",
      "confidence": 0.95
    }
  ],
  "relationships": [
    {
      "type": "trabalha_em",
      "fromEntity": { "label": "Leonardo", "category": "PESSOA" },
      "toEntity": { "label": "Empresa X", "category": "TRABALHO" }
    }
  ]
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/knowledge/entities/{instanceName}?remoteJid={jid}&category={cat}</code> &mdash; Entities by category</summary>

&nbsp;

> **Auth:** Session

**Query params**

| Param | Type | Required |
|-------|------|----------|
| `remoteJid` | string | Yes |
| `category` | string (entity category) | No |

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/knowledge/extract/{instanceName}</code> &mdash; Extract knowledge from messages</summary>

&nbsp;

> **Auth:** Session

**Request body**

```json
{
  "remoteJid": "5511999999999@s.whatsapp.net",
  "messageCount": 50
}
```

**Response `200`** — Full contact knowledge object (same schema as `GET /knowledge/contact`).

</details>

<details>
<summary><img src="https://img.shields.io/badge/DELETE-F44336" alt="DELETE"> <code>/knowledge/contact/{instanceName}?remoteJid={jid}</code> &mdash; Delete all knowledge for a contact</summary>

&nbsp;

> **Auth:** Session

**Response `200`**

```json
{ "ok": true }
```

</details>

#### Contact Names

<details>
<summary><img src="https://img.shields.io/badge/PUT-FFA000" alt="PUT"> <code>/knowledge/contact-name/{instanceName}</code> &mdash; Save custom contact name</summary>

&nbsp;

> **Auth:** Session

**Request body**

```json
{
  "remoteJid": "5511999999999@s.whatsapp.net",
  "name": "Leonardo Andrade"
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/knowledge/saved-contacts/{instanceName}</code> &mdash; List contacts with custom names</summary>

&nbsp;

> **Auth:** Session

</details>

#### Tasks

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/knowledge/tasks/{instanceName}?remoteJid={jid}</code> &mdash; Active tasks for a contact</summary>

&nbsp;

> **Auth:** Session

</details>

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/knowledge/tasks/{instanceName}</code> &mdash; AI-extract tasks from conversation</summary>

&nbsp;

> **Auth:** Session

**Request body**

```json
{
  "remoteJid": "5511999999999@s.whatsapp.net"
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/PUT-FFA000" alt="PUT"> <code>/knowledge/task/{instanceName}</code> &mdash; Update a task</summary>

&nbsp;

> **Auth:** Session

**Request body**

```json
{
  "taskId": "uuid",
  "status": "concluida",
  "priority": "alta"
}
```

</details>

<details>
<summary><img src="https://img.shields.io/badge/DELETE-F44336" alt="DELETE"> <code>/knowledge/task/{instanceName}?taskId={uuid}</code> &mdash; Delete a task</summary>

&nbsp;

> **Auth:** Session

</details>

---

### Message Queue

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/queue/schedule</code> &mdash; Schedule message for later</summary>

&nbsp;

> **Auth:** Session

**Request body**

```json
{
  "instance": "WhatsApp-1",
  "number": "5511999999999",
  "text": "Lembrete: reuniao amanha",
  "sendAt": 1712786400
}
```

`sendAt` is a Unix timestamp (seconds). Queue processor runs every 5s.

</details>

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/queue/status</code> &mdash; Queue health check</summary>

&nbsp;

> **Auth:** Session

**Response `200`**

```json
{ "queued": 3, "redis": true }
```

</details>

---

### Server-Sent Events

<details>
<summary><img src="https://img.shields.io/badge/GET-2196F3" alt="GET"> <code>/events</code> &mdash; Real-time event stream</summary>

&nbsp;

> **Auth:** Session &nbsp;|&nbsp; **Content-Type:** `text/event-stream`

**Connection event:**

```
event: connected
data: {"status":"ok"}
```

**Message event (example):**

```
event: messages.upsert
data: {"event":"messages.upsert","data":{"key":{"remoteJid":"..."},"message":{"conversation":"Hello"}}}
```

**Available event types:**

| Event | Description |
|-------|-------------|
| `messages.upsert` | New message received/sent |
| `messages.update` | Message status updated (read, delivered) |
| `connection.update` | Instance connection state changed |
| `chats.update` | Chat metadata updated |
| `chats.upsert` | New chat created |
| `presence.update` | Contact online/typing status |
| `group-participants.update` | Group membership changed |

</details>

---

### Webhook

<details>
<summary><img src="https://img.shields.io/badge/POST-49CC90" alt="POST"> <code>/webhook/internal</code> &mdash; Receive events from Evolution API</summary>

&nbsp;

> **Auth:** HMAC-SHA256 via `x-webhook-signature` header &nbsp;|&nbsp; **Rate limit:** 100 req/sec

**Security stack:**
1. HMAC-SHA256 signature verification (constant-time comparison)
2. Event whitelist — only known event types accepted
3. Dedicated rate limiter — 100 req/sec

**Request body**

```json
{
  "event": "MESSAGES_UPSERT",
  "instance": "WhatsApp-1",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "msg123"
    },
    "message": { "conversation": "Oi!" },
    "messageTimestamp": 1712700000,
    "pushName": "Leonardo"
  }
}
```

**Responses**

| Status | Body | Reason |
|--------|------|--------|
| `200` | `{"ok":true}` | Event accepted |
| `400` | `{"error":"unknown event"}` | Event not in whitelist |
| `401` | `{"error":"invalid signature"}` | HMAC verification failed |
| `429` | `{"error":"rate limit"}` | Exceeded 100 req/sec |

</details>

---

### Evolution API Proxy

All [Evolution API](https://doc.evolution-api.com) calls are proxied through Manhattan with authentication and caching.

> **Prefixes:** `/instance/*` &nbsp; `/message/*` &nbsp; `/chat/*` &nbsp; `/group/*` &nbsp; `/webhook/*`
>
> **Rate limit:** 120 req/min per IP &nbsp;|&nbsp; **Cache header:** `X-Cache: HIT` or `MISS`

**Cached routes (GET only):**

| Route | TTL |
|-------|-----|
| `/instance/fetchInstances` | 15s |
| `/chat/findContacts/*` | 5min |
| `/group/fetchAllGroups/*` | 2min |

<details>
<summary><strong>Common proxy endpoints</strong> (click to expand)</summary>

&nbsp;

#### Instances

| Method | Path | Description |
|--------|------|-------------|
| ![GET](https://img.shields.io/badge/GET-2196F3) | `/instance/fetchInstances` | List all WhatsApp instances |
| ![POST](https://img.shields.io/badge/POST-49CC90) | `/instance/create` | Create new instance |

#### Messages

| Method | Path | Description |
|--------|------|-------------|
| ![POST](https://img.shields.io/badge/POST-49CC90) | `/message/sendText/{instance}` | Send text message |
| ![POST](https://img.shields.io/badge/POST-49CC90) | `/message/sendMedia/{instance}` | Send media (image, video, doc) |

#### Chats

| Method | Path | Description |
|--------|------|-------------|
| ![POST](https://img.shields.io/badge/POST-49CC90) | `/chat/findChats/{instance}` | List recent chats |
| ![POST](https://img.shields.io/badge/POST-49CC90) | `/chat/findMessages/{instance}` | Get messages for a chat |
| ![GET](https://img.shields.io/badge/GET-2196F3) | `/chat/findContacts/{instance}` | List contacts |

#### Groups

| Method | Path | Description |
|--------|------|-------------|
| ![GET](https://img.shields.io/badge/GET-2196F3) | `/group/fetchAllGroups/{instance}` | List all groups |
| ![POST](https://img.shields.io/badge/POST-49CC90) | `/group/create/{instance}` | Create group |
| ![GET](https://img.shields.io/badge/GET-2196F3) | `/group/participants/{instance}` | Get group members |

> For the complete Evolution API reference, see the [official docs](https://doc.evolution-api.com).

</details>

---

## Security

| Layer | Details |
|-------|---------|
| **Session** | HttpOnly cookies, SameSite=Strict, 24h TTL |
| **2FA** | 6-digit code via WhatsApp (3-min window) |
| **Rate limiting** | 120 req/min (API), 100 req/sec (webhook) — Redis-backed with memory fallback |
| **Webhook auth** | HMAC-SHA256 with constant-time comparison |
| **Headers** | CSP, X-Frame-Options DENY, nosniff, XSS Protection, strict Referrer-Policy |
| **Path traversal** | Static file serving validates all paths |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `EVO_API_URL` | Yes | `http://localhost:8080` | Evolution API base URL |
| `EVO_API_KEY` | Yes | — | Evolution API key |
| `OPENAI_API_KEY` | For AI | — | OpenAI API key (gpt-4o-mini) |
| `PORT` | No | `3000` | Server port |
| `REDIS_URL` | No | — | Redis connection URL |
| `WEBHOOK_SECRET` | No | — | HMAC secret for webhook verification |
| `WEBHOOK_URL` | No | `http://localhost:3000/webhook/internal` | Webhook callback URL |
| `ADMIN_PASS` | No | `changeme` | Initial admin password |
| `USE_REACT_FRONTEND` | No | `false` | Serve React frontend instead of vanilla JS |

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────────┐
│  WhatsApp    │     │  Manhattan Server (:3000)                       │
│  (via Evo)   │◄───►│                                                 │
└─────────────┘     │  ┌─────────┐  ┌─────┐  ┌───────────────────┐   │
                    │  │  Auth   │  │ SSE │  │ Evolution Proxy   │   │
┌─────────────┐     │  │  + 2FA  │  │     │  │ (cache layer)     │   │
│  Browser     │◄───►│  └─────────┘  └─────┘  └───────────────────┘   │
│  (SPA)       │     │  ┌─────────┐  ┌─────────────┐  ┌───────────┐  │
└─────────────┘     │  │   AI    │  │  Knowledge  │  │  Message  │  │
                    │  │ OpenAI  │  │    Graph    │  │   Queue   │  │
┌─────────────┐     │  └─────────┘  └─────────────┘  └───────────┘  │
│  Evolution   │◄───►│                                                 │
│  API         │     └──────────────────────────────────────────────────┘
└─────────────┘              │              │
                    ┌────────▼──┐    ┌──────▼──────┐
                    │ PostgreSQL│    │    Redis     │
                    │           │    │ (optional)   │
                    └───────────┘    └─────────────┘
```

---

<sub>Generated from source code analysis. For detailed API documentation, see [API.md](./API.md).</sub>
