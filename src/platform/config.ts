import { z } from "zod/v4";

export const PlatformEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
  FLEET_DATA_DIR: z.string().default("/data/fleet"),
  RESEND_API_KEY: z.string().min(1).optional(),
  FROM_EMAIL: z.string().email().optional(),
  APP_BASE_URL: z.string().url().optional(),
  UI_ORIGIN: z.string().url().optional(),
});

export type PlatformEnv = z.infer<typeof PlatformEnvSchema>;

export function loadPlatformEnv(): PlatformEnv {
  return PlatformEnvSchema.parse(process.env);
}
