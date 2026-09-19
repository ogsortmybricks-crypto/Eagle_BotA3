import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: process.env.SESSION_SECRET ?? "eagle-bot-dev-secret-change-me",
  appUrl: (process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 5000}`).replace(/\/$/, ""),

  /**
   * Claims the dev portal's head account, once. Required in production - the
   * portal publishes Tac-Ons every academy can install, so whoever holds this
   * key holds the market.
   */
  portalSetupKey: process.env.DEV_PORTAL_SETUP_KEY ?? "",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",

  smtp: {
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  },
};

export const aiConfigured = Boolean(env.anthropicApiKey);
export const emailConfigured = Boolean(env.smtp.user && env.smtp.pass);
