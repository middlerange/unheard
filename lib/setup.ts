type SetupEnvironment = Record<string, string | undefined>;

export function getSetupEnvironmentStatus(
  env: SetupEnvironment,
  hasMediaBinding = false,
) {
  return {
    session: Boolean(
      env.SESSION_SECRET &&
      env.SESSION_SECRET.length >= 32 &&
      !env.SESSION_SECRET.startsWith('dev-secret'),
    ),
    encryption: /^[a-fA-F0-9]{64}$/.test(env.CREDENTIALS_ENCRYPTION_KEY ?? ''),
    media:
      hasMediaBinding ||
      Boolean(
        env.R2_ACCOUNT_ID &&
        env.R2_ACCESS_KEY_ID &&
        env.R2_SECRET_ACCESS_KEY &&
        env.R2_BUCKET_NAME &&
        env.R2_PUBLIC_URL,
      ),
    ai: Boolean(env.OPENAI_API_KEY),
    research: Boolean(env.ANTHROPIC_API_KEY),
    linkedin: Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),
    meta: Boolean(
      (env.META_APP_ID || env.FACEBOOK_APP_ID) &&
      (env.META_APP_SECRET || env.FACEBOOK_APP_SECRET),
    ),
    youtube: Boolean(
      (env.YOUTUBE_CLIENT_ID || env.GOOGLE_CLIENT_ID) &&
      (env.YOUTUBE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET),
    ),
    reddit: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    telegramApproval: Boolean(
      env.TELEGRAM_BOT_TOKEN &&
      env.TELEGRAM_CHAT_ID &&
      (env.TELEGRAM_APPROVER_USER_ID ||
        !env.TELEGRAM_CHAT_ID.startsWith('-')) &&
      env.TELEGRAM_WEBHOOK_SECRET,
    ),
  };
}
