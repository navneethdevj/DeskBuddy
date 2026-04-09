import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://', {
    message: 'DATABASE_URL must start with postgresql://',
  }),
  REDIS_URL: z.string().startsWith('redis://', {
    message: 'REDIS_URL must start with redis://',
  }),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']),
  CORS_ORIGIN: z.string().min(1),
});

type Config = z.infer<typeof ConfigSchema>;

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.errors
    .map((e) => `  ${e.path.join('.')}: ${e.message}`)
    .join('\n');
  throw new Error(`❌ Invalid environment configuration:\n${formatted}`);
}

const config: Readonly<Config> = Object.freeze(parsed.data);

export default config;
