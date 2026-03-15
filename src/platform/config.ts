import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string(),

  // Stripe billing
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Metered inference gateway
  OPENROUTER_API_KEY: z.string().optional(),

  // GitHub App
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),

  // Fleet
  FLEET_DATA_DIR: z.string().default("/data/fleet"),

  // Email
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().default("noreply@holyship.dev"),

  // UI
  APP_BASE_URL: z.string().default("https://holyship.dev"),
  UI_ORIGIN: z.string().default("http://localhost:3200"),
});

export type HolyshipConfig = z.infer<typeof ConfigSchema>;

let cached: HolyshipConfig | null = null;

export function getConfig(): HolyshipConfig {
  if (!cached) {
    cached = ConfigSchema.parse(process.env);
  }
  return cached;
}
