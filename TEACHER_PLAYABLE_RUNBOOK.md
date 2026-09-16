# Kowloon Walled City: Playable Runbook

This package is the playable source build. It deliberately excludes
`node_modules`, `.env`, reports, slides, and local database files.

## Requirements

- Node.js 22.12 or newer
- pnpm through Corepack
- An OpenAI-compatible API key. The defaults target DeepSeek's own endpoint
  with `deepseek-flash`.

## Quick Start

```bash
corepack enable pnpm
corepack use pnpm@latest-10
pnpm install
cp .env.example .env
pnpm dev
```

Then open:

- Game: http://localhost:5173
- Backend health/API base: http://127.0.0.1:8787

Before running `pnpm dev`, edit `.env` and set:

```text
OPENAI_API_KEY=<your-deepseek-api-key>
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-flash
DB_FILE_NAME=file:local.db
LOG_LEVEL=info
```

`OPENAI_BASE_URL` and `OPENAI_MODEL` have to agree with each other. Sending a
DeepSeek model name to a different vendor fails at request time as a 404 that
reads like a bad API key, which is a confusing way to spend an afternoon.

## Expect The First Turn To Be Slow

`deepseek-flash` is a reasoning model. It writes a long chain-of-thought
before it answers, so a day of four AI turns takes tens of seconds. That is
latency, not a hang — the game state and the rules are validated locally and
stay correct either way.

## Production-Style Start

For a single-process Node deployment, build first and then start the Fastify
server. The server serves both `/api/*` and the built web app from
`apps/web/dist`.

```bash
pnpm build
pnpm start
```

For a public server, set:

```text
HOST=0.0.0.0
PORT=<provider-port-or-8787>
```

## What To Try First

1. Click `NEW GAME`.
2. Move with `WASD` (arrow keys work too).
3. Press `E` near a workshop, the martial arts hall, the night market, the
   dungeon, or one of the four residents.
4. Labor first — it is mandatory each day. Do odd jobs for Kong Soh Biscuits
   and Goods, or practice kung fu for Might.
5. Trade at the night market to turn Goods into Coins, or negotiate with a
   resident.
6. Click `End Turn` and watch the AI agents take theirs.
7. If the trade phase and your resources allow it, enter the dungeon and fight
   the boss with `WASD` to move, `Space` for the flash skill, and `Q` for the
   ultimate.

## Troubleshooting

- If `NEW GAME` fails, confirm the backend is running on port `8787`.
- If AI calls fail, check `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and
  `OPENAI_MODEL` in `.env`. A 404 usually means the base URL and the model
  belong to different vendors.
- If NPC dialogue is slow, it is the model's reasoning budget, not a crash.
- If port `5173` or `8787` is already in use, stop the old process and rerun
  `pnpm dev`.
- If the browser shows an old version, hard refresh the page after restarting
  the dev server.

## Validation Commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck`, `pnpm test`, and `pnpm build` pass as of 2026-09-15.

The browser end-to-end suite additionally needs a browser binary, which is not
installed by `pnpm install`:

```bash
pnpm test:e2e -- --project=chromium   # requires: npx playwright install chromium
```

Dependencies are restored by `pnpm install` from `pnpm-lock.yaml`.
