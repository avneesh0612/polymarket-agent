# LangGraph Dynamic Agent

A Web3 AI agent with three independent packages:

- **`agent/`** — Bun CLI agent (text + voice REPL using sox + ElevenLabs)
- **`backend/`** — Hono REST API server (Bun) — agent, voice, webhooks, Supabase
- **`mobile/`** — Expo React Native app (text + voice chat, Dynamic auth)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  mobile/   Expo React Native                                    │
│  ─ Dynamic RN SDK  → auth + wallet delegation                   │
│  ─ Text chat  → POST /api/agent                                 │
│  ─ Voice input  → expo-av record → POST /api/voice/stt          │
│  ─ Voice output → POST /api/voice/tts → expo-av play           │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Bearer JWT
┌───────────────────────────▼─────────────────────────────────────┐
│  backend/  Hono on Bun  (localhost:3001)                        │
│  POST /api/agent          → LangGraph + Claude Haiku            │
│  GET  /api/delegation/status                                    │
│  POST /api/webhooks/dynamic → HMAC verify → Supabase store      │
│  POST /api/voice/stt      → ElevenLabs Scribe v1               │
│  POST /api/voice/tts      → ElevenLabs Turbo v2.5              │
│  Persistence: Supabase (delegations, agent_memory, audit_logs)  │
└─────────────────────────────────────────────────────────────────┘

agent/  Bun CLI  (standalone, no backend needed)
  bun run start  → interactive text REPL
  bun run voice  → voice REPL (sox + ElevenLabs)
  Persistence: agent-memory.json (JsonFileSaver)
```

---

## Features

### All modes (CLI + mobile)
- Multi-chain token balance lookup via Dynamic API
- Polymarket prediction market search & betting
- LI.FI cross-chain swaps/bridges to fund Polymarket USDC
- Delegated EVM wallet signing (no private key exposure)
- Conversation memory persistence across restarts

### CLI only (`agent/`)
- Interactive text REPL (`bun run start`)
- Voice REPL: ElevenLabs STT + TTS via `sox` recording (`bun run voice`)
- Confirmation prompts before executing trades
- Audit log file

### Mobile app (`mobile/`)
- Dynamic Labs React Native SDK for wallet login & delegation
- Text chat with suggested commands
- Voice input: tap mic → record → ElevenLabs STT → send to agent
- Voice output: agent response → ElevenLabs TTS → auto-playback
- Voice output toggle (🔊/🔇)
- Login & delegation banners guide users through setup

### Backend (`backend/`)
- JWT auth via Dynamic Labs JWKS endpoint
- HMAC-SHA256 webhook signature verification
- RSA-OAEP + AES-256-GCM decryption of delegated key shares
- Supabase-backed agent memory (SupabaseSaver — survives restarts)
- Supabase audit_logs table (every agent event)

---

## Setup & Running

### 1. Prerequisites

- [Bun](https://bun.sh) ≥ 1.3.5
- [Node.js](https://nodejs.org) ≥ 18 (for mobile)
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (`npm i -g expo-cli`)
- [sox](https://sox.sourceforge.net) (`brew install sox`) — CLI voice mode only
- Supabase project (free tier works)
- Dynamic Labs account + environment
- Anthropic API key
- ElevenLabs API key

### 2. Supabase migrations

```bash
cd backend
# Run both migrations in the Supabase SQL editor or via CLI:
supabase db push
# Migrations:
#   supabase/migrations/001_delegations.sql  — delegation records
#   supabase/migrations/002_memory.sql       — agent memory + audit logs
```

### 3. Agent (CLI)

```bash
cd agent
cp .env.example .env    # fill in your credentials
bun install             # already done if you ran setup
bun run start           # text REPL
bun run voice           # voice REPL (requires sox + ElevenLabs)
```

**Example commands:**
```
You: show my wallet
You: check my USDC balance on polygon
You: bet $5 on golden state warriors winning
You: show my polymarket positions
You: swap 0.01 ETH from ethereum to USDC on polygon
You: show all my token balances with prices
```

### 4. Backend (API Server)

```bash
cd backend
cp .env.example .env    # fill in your credentials
bun install
bun run dev             # http://localhost:3001
```

### 5. Mobile (React Native)

> **Requires a development build** — not compatible with Expo Go.

```bash
cd mobile
cp .env.example .env    # fill in EXPO_PUBLIC_API_URL + EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID
npm install
npm run prebuild        # generates ios/ and android/ directories
expo run:ios            # or: expo run:android
```

---

## Environment Variables

### `agent/.env`

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `DYNAMIC_ENVIRONMENT_ID` | ✅ | Dynamic environment ID |
| `DYNAMIC_API_KEY` | ✅ | Dynamic API key (for MPC signing) |
| `DYNAMIC_USER_JWT` | ✅ | User JWT for Dynamic balance API |
| `DELEGATED_WALLET_ID` | ✅ | Delegated wallet ID |
| `DELEGATED_WALLET_ADDRESS` | ✅ | Wallet address (0x...) |
| `DELEGATED_WALLET_API_KEY` | ✅ | Pre-decrypted wallet API key |
| `DELEGATED_KEY_SHARE` | ✅ | Key share JSON string |
| `ELEVENLABS_API_KEY` | Voice only | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Voice only | ElevenLabs voice ID |

### `backend/.env`

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `DYNAMIC_ENVIRONMENT_ID` | ✅ | Dynamic environment ID |
| `DYNAMIC_API_KEY` | ✅ | Dynamic API key (for MPC signing) |
| `DYNAMIC_WEBHOOK_SECRET` | ✅ | HMAC secret for webhook verification |
| `DYNAMIC_DELEGATION_PRIVATE_KEY` | ✅ | RSA private key (PEM) for decryption |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key |
| `ELEVENLABS_API_KEY` | ✅ | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | Optional | ElevenLabs voice ID |
| `PORT` | Optional | Server port (default: 3001) |

### `mobile/.env`

| Variable | Required | Description |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | ✅ | Backend URL (e.g. `http://localhost:3001`) |
| `EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID` | ✅ | Dynamic environment ID |

---

## API Routes (Backend)

| Route | Auth | Description |
|---|---|---|
| `GET /` | None | Health check |
| `POST /api/agent` | Bearer JWT | Run agent — returns `{ response: string }` |
| `GET /api/delegation/status` | Bearer JWT | Returns `{ delegated: bool, address?, chain? }` |
| `POST /api/webhooks/dynamic` | HMAC-SHA256 | Dynamic wallet delegation webhook |
| `POST /api/voice/stt` | Bearer JWT | Audio → text (multipart/form-data, field: `audio`) |
| `POST /api/voice/tts` | Bearer JWT | Text → MP3 audio (`{ text: string }`) |

---

## Delegation Flow

1. User logs in with Dynamic in the mobile app
2. App calls `dynamicClient.wallets.delegation.shouldPromptWalletDelegation()`
3. If needed, calls `initDelegationProcess()` → Dynamic sends webhook to backend
4. Backend receives `wallet.delegation.created` webhook:
   - Verifies HMAC-SHA256 signature
   - Decrypts RSA-OAEP + AES-GCM encrypted key shares
   - Stores credentials in Supabase `delegations` table
5. Agent reads delegation from Supabase on each request and signs transactions via Dynamic MPC
