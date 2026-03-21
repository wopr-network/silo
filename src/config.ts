import { z } from "zod/v4";

/** Treat empty strings as undefined so Docker Compose blank defaults don't fail min(1). */
const optStr = z
  .string()
  .min(1)
  .optional()
  .or(z.literal("").transform(() => undefined));

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),

  // Auth
  BETTER_AUTH_SECRET: optStr,

  // Platform
  UI_ORIGIN: z.string().default("https://holyship.wtf"),
  APP_BASE_URL: z.string().url().default("https://api.holyship.wtf"),

  // Billing
  STRIPE_SECRET_KEY: optStr,
  STRIPE_WEBHOOK_SECRET: optStr,

  // Gateway (metered inference proxy)
  OPENROUTER_API_KEY: optStr,

  // GitHub App
  GITHUB_APP_ID: optStr,
  GITHUB_APP_PRIVATE_KEY: optStr,
  GITHUB_WEBHOOK_SECRET: optStr,

  // Worker/admin auth tokens
  HOLYSHIP_ADMIN_TOKEN: optStr,
  HOLYSHIP_WORKER_TOKEN: optStr,

  // Fleet
  FLEET_DATA_DIR: z.string().default("/data/fleet"),

  // Holyshipper ephemeral containers
  HOLYSHIP_WORKER_IMAGE: optStr,
  HOLYSHIP_GATEWAY_KEY: optStr,
  DOCKER_NETWORK: optStr,

  // Platform service key for direct gateway calls (e.g. flow editing)
  HOLYSHIP_PLATFORM_SERVICE_KEY: optStr,

  // Notifications (Resend)
  RESEND_API_KEY: optStr,
  FROM_EMAIL: z.string().default("noreply@holyship.wtf"),

  // Crypto payments (BTCPay)
  BTCPAY_API_KEY: optStr,
  BTCPAY_BASE_URL: optStr,
  BTCPAY_STORE_ID: optStr,
  BTCPAY_WEBHOOK_SECRET: optStr,

  // EVM (stablecoin + ETH payments)
  EVM_XPUB: optStr,
  EVM_RPC_BASE: optStr,

  // Crypto service
  CRYPTO_SERVICE_URL: optStr,
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | undefined;

export function getConfig(): Config {
  if (!_config) {
    _config = envSchema.parse(process.env);
  }
  return _config;
}
