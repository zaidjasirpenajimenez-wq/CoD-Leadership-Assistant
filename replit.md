# Kingdom Guardian Pro

Sistema integrado de Bot de Discord y Dashboard Web para gestión militar, logística y contrainteligencia en Call of Dragons.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Required env: `DISCORD_TOKEN`, `MONGODB_URI`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Bot: discord.js v14 (Multi-Tenancy — multi-server)
- DB: MongoDB Atlas + Mongoose (strict schemas)
- OCR: tesseract.js (memory-optimized)
- Build: esbuild (CJS bundle)
- Dashboard: Single-page HTML with React 18 CDN + Tailwind CDN

## Where things live

- `artifacts/api-server/src/bot/` — Discord bot modules
  - `client.ts` — Bot entry point, slash command registration
  - `ocr.ts` — Tesseract.js OCR engine (memory-safe)
  - `modules/sentinel.ts` — Anti-raid, anti-spam, anti-links
  - `modules/modCommands.ts` — /mod ban/kick/mute/warn/clear
  - `modules/warCommands.ts` — /war alert/attack/defense
  - `modules/resourceCommands.ts` — /request resources (propósito + cantidades de Madera/Piedra/Oro)
  - `modules/sweeperCommands.ts` — /roster sweep + #player-verification listener
  - `modules/diplomacyCommands.ts` — /diplomacy radar/add
  - `modules/setupCommands.ts` — /setup alliance/channels/status
- `artifacts/api-server/src/db/` — MongoDB schemas and connection
  - `schemas.ts` — GuildConfig, UserProfile, DiplomacyPact, KvkRecord, etc.
  - `mongoose.ts` — Connection with auto-reconnect
- `artifacts/api-server/src/routes/health.ts` — Health check endpoint
- `Dockerfile` — Build & deploy image for Railway/Koyeb (free tier)

## Architecture decisions

- **Multi-tenancy via guildId**: Every schema uses guildId as the primary partition key. Designed for one server but works cleanly across multiple.
- **OCR memory management**: Tesseract.js worker is reused across requests but parameters are reset after each run to prevent OOM on free-tier hosts.
- **Slash commands registered globally**: Commands are registered globally on bot startup (not per-guild) for maximum compatibility.
- **No dashboard**: The web dashboard and spy/intel system have been removed. The server only exposes a `/api/health` endpoint.

## Product

- **El Centinela**: Anti-raid (5 joins/10s quarantine), anti-spam (4 msgs/3s timeout), anti-links, /mod commands with warn accumulation (3 warns = 24h auto-timeout)
- **Comando Táctico**: /war alert with live response buttons, /attack order (red format), /defense order (blue format)
- **Banco de Suministros**: /request resources — resource request workflow with farmer assignment and receipt confirmation buttons
- **El Sweeper**: #player-verification auto-registration via profile screenshot OCR, /roster sweep cross-reference. Checks blacklist automatically on OCR — blocks silently and alerts R5.
- **Panel Diplomático**: /diplomacy add/radar for NAP, ALLY, ENEMY, BORDER pacts
- **Lista Negra**: /blacklist add/remove/view/check — auto-blocks banned IGNs at OCR verification
- **Eventos RSVP**: /evento crear/lista/cancelar — RSVP buttons (+10 pts on confirm), auto DM reminder 30 min before, auto-close 3h after
- **Misiones Semanales**: /mision ver/reclamar/ranking — 3 missions (wars, donations, points), +50 pts bonus on completion, resets weekly
- **Polls**: /poll crear/cerrar/activas — multi-option voting, auto-closes, live vote counter
- **DM al farmer**: when farmer accepts resource request, requester gets instant DM with donor name and resource details

## User preferences

- Stack: discord.js v14, Mongoose, tesseract.js
- Target: Railway/Koyeb free-tier hosting (low memory) — use `Dockerfile` at project root

## Gotchas

- DISCORD_TOKEN must be the bot token from discord.com/developers/applications — NOT an invite link
- Tesseract.js v7 build scripts must be approved: run `pnpm approve-builds` if reinstalling
- The bot must have intents enabled in Discord Developer Portal: Server Members Intent, Message Content Intent
- discord.js is externalized in esbuild — it bundles from node_modules directly
- Do NOT run `pnpm dev` at workspace root — use the workflow or `pnpm --filter @workspace/api-server run dev`
- SPY_WEBHOOK_URL has been removed — the spy/intel system no longer exists

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
