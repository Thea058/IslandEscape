# Submission Packaging Notes

Date: 2026-05-24

## Recommendation

Submit a source-code zip, not a newly built `.exe`.

The current project is a TypeScript monorepo with a Vue/PixiJS frontend and a Fastify backend. It does not already include Electron, Tauri, `pkg`, or `nexe` configuration. Building a reliable Windows executable in the final hour would require adding a desktop shell, bundling or launching the backend, handling native SQLite/libsql dependencies, and retesting the full LLM flow.

The source archive created from Git measures about 2.5 MB, far below the 100 MB submission limit. A 26 MB `IslandEscape_Final.pptx` deck used to sit at the repo root and was removed; it survives in history, but `git archive` exports the tree, not the history, so the zip is unaffected.

## What to exclude from the submission zip

- `node_modules/`
- `.git/`
- `.claude/`
- `.codex-logs/`
- `.env` and any real API keys
- local SQLite database files under `apps/server/*.db`
- Playwright reports and test result folders

## Recommended run instructions

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

The live LLM demo requires local environment variables:

```text
OPENAI_API_KEY=<local key>
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-flash
```

Do not commit the real key to the repository. If the instructor needs to run the LLM path, provide the key separately or configure it only on the demo machine.

## Current checked package size

Command used:

```powershell
git archive --format=zip -o ..\source-current.zip HEAD
```

`..\` writes the archive next to the repo instead of inside it, so it can't be
committed by accident, and it keeps the command working on any machine — the
absolute path this used to have only resolved on one person's desktop.

Measured size: about 29 MB, across 158 files. Re-measure with `du -h` on the archive after any large file is committed — this number has drifted by an order of magnitude before, when the presentation deck was added.
