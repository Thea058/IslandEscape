import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const shouldOverrideEnv = process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true'
const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url))
config({ path: rootEnvPath, override: shouldOverrideEnv })

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
