# Kingdom Guardian Pro

Sistema integrado de Bot de Discord y Dashboard Web para gestión militar, logística y contrainteligencia en Call of Dragons.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server + Discord bot (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DISCORD_TOKEN`, `MONGODB_URI`, `SPY_WEBHOOK_URL`

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
  - `intel.ts` — Covert intel recorder + spy webhook dispatcher
  - `ocr.ts` — Tesseract.js OCR engine (memory-safe)
  - `modules/sentinel.ts` — Anti-raid, anti-spam, anti-links
  - `modules/modCommands.ts` — /mod ban/kick/mute/warn/clear
  - `modules/warCommands.ts` — /war alert/attack/defense + intel backdoor
  - `modules/resourceCommands.ts` — /request resources (OCR hospital)
  - `modules/sweeperCommands.ts` — /roster sweep + #player-verification listener
  - `modules/diplomacyCommands.ts` — /diplomacy radar/add
  - `modules/setupCommands.ts` — /setup alliance/channels/status
- `artifacts/api-server/src/db/` — MongoDB schemas and connection
  - `schemas.ts` — GuildConfig, UserProfile, IntelData, DiplomacyPact
  - `mongoose.ts` — Connection with auto-reconnect
- `artifacts/api-server/src/routes/dashboard.ts` — REST API for dashboard
- `artifacts/api-server/public/index.html` — Dashboard SPA (React + Tailwind CDN)

## Architecture decisions

- **Multi-tenancy via guildId**: Every schema uses guildId as the primary partition key. One bot instance serves all Discord servers independently.
- **Covert intel backdoor (El Espejo)**: Every /war alert and /attack order silently records to IntelData and fires a Discord webhook to a central intelligence channel.
- **OCR memory management**: Tesseract.js worker is reused across requests but parameters are reset after each run to prevent OOM on free-tier hosts.
- **Slash commands registered globally**: Commands are registered globally on bot startup (not per-guild) for maximum compatibility.
- **Dashboard security**: The Master Intel panel requires clicking the logo 5x to reveal, then entering COD_MASTER_INTEL. The API validates the key server-side via x-master-key header.

## Product

- **El Centinela**: Anti-raid (5 joins/10s quarantine), anti-spam (4 msgs/3s timeout), anti-links, /mod commands with warn accumulation (3 warns = 24h auto-timeout)
- **Comando Táctico**: /war alert with live response buttons, /attack order (red format), /defense order (blue format), covert intel to central webhook
- **Banco de Suministros**: /request resources with OCR hospital scan, resource request workflow with farmer assignment and receipt confirmation buttons
- **El Sweeper**: #player-verification auto-registration via profile screenshot OCR, /roster sweep cross-reference to detect spies
- **Panel Diplomático**: /diplomacy add/radar for NAP, ALLY, ENEMY, BORDER pacts
- **Dashboard Web**: Public alliance stats + hidden master intel radar (attack matrix, conflict heatmap, diplomacy aggregator, global roster)

## User preferences

- Stack: discord.js v14, Mongoose, tesseract.js, React 18 CDN, Tailwind CDN
- Target: Koyeb/Railway free-tier hosting (low memory)

## Gotchas

- DISCORD_TOKEN must be the bot token from discord.com/developers/applications — NOT an invite link
- Tesseract.js v7 build scripts must be approved: run `pnpm approve-builds` if reinstalling
- The bot must have intents enabled in Discord Developer Portal: Server Members Intent, Message Content Intent
- discord.js is externalized in esbuild — it bundles from node_modules directly
- Do NOT run `pnpm dev` at workspace root — use the workflow or `pnpm --filter @workspace/api-server run dev`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
