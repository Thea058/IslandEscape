import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

const shouldOverrideEnv = process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true'

/**
 * Absolute path to the workspace-root `.env`.
 *
 * Deliberately not a fixed `'../../../.env'`: the compiled copy sits one level
 * deeper than the source (`dist/src/env.js` versus `src/env.ts`), so any fixed
 * number of hops resolves correctly for exactly one of the two — and it is the
 * compiled one that `pnpm start` runs, where a wrong path loads zero variables
 * and fails as a missing OPENAI_API_KEY rather than a missing file.
 *
 * Walking up to the workspace root is layout-proof instead.
 */
function rootEnvPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.env')
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('Could not locate the workspace root: no pnpm-workspace.yaml above this file')
    }
    dir = parent
  }
}

config({ path: rootEnvPath(), override: shouldOverrideEnv })

export const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  // Base URL and model default as a matched pair — a DeepSeek model name on
  // OpenAI's endpoint (or the reverse) only fails at request time, as a 404
  // that reads like a bad key. Keep these two pointing at the same vendor.
  OPENAI_BASE_URL: z.string().default('https://api.deepseek.com'),
  OPENAI_MODEL: z.string().default('deepseek-flash'),
  DB_FILE_NAME: z.string().default('file:local.db'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.string().default('info'),
})

export const env = EnvSchema.parse(process.env)
console.log('[env] OPENAI_MODEL =', env.OPENAI_MODEL)
console.log('[env] OPENAI_BASE_URL =', env.OPENAI_BASE_URL)
