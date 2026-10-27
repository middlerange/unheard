import { describe, expect, it } from 'vitest';
import { getSetupEnvironmentStatus } from './setup';

describe('setup environment checks', () => {
  it('reports independent research and writing provider readiness without exposing keys', () => {
    expect(getSetupEnvironmentStatus({ ANTHROPIC_API_KEY: 'private-anthropic' })).toMatchObject({ research: true, ai: false });
    expect(getSetupEnvironmentStatus({ OPENAI_API_KEY: 'private-openai' })).toMatchObject({ research: false, ai: true });
  });
  it('returns booleans only and rejects invalid security settings', () => {
    const status = getSetupEnvironmentStatus({
      SESSION_SECRET: 'dev-secret-change-me-in-production!!',
      CREDENTIALS_ENCRYPTION_KEY: 'z'.repeat(64),
      META_APP_ID: 'private-id',
      META_APP_SECRET: 'private-secret',
    });
    expect(status.session).toBe(false);
    expect(status.encryption).toBe(false);
    expect(status.meta).toBe(true);
    expect(
      Object.values(status).every((value) => typeof value === 'boolean'),
    ).toBe(true);
    expect(JSON.stringify(status)).not.toContain('private-secret');
  });

  it('recognizes native media storage and complete provider aliases', () => {
    const status = getSetupEnvironmentStatus(
      {
        SESSION_SECRET: 'a'.repeat(32),
        CREDENTIALS_ENCRYPTION_KEY: 'a1'.repeat(32),
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        LINKEDIN_CLIENT_ID: 'id',
      },
      true,
    );
    expect(status.session).toBe(true);
    expect(status.encryption).toBe(true);
    expect(status.media).toBe(true);
    expect(status.youtube).toBe(true);
    expect(status.linkedin).toBe(false);
  });

  it('requires all media configuration for the S3 fallback', () => {
    const env = {
      R2_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'id',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET_NAME: 'bucket',
    };
    expect(getSetupEnvironmentStatus(env).media).toBe(false);
    expect(
      getSetupEnvironmentStatus({
        ...env,
        R2_PUBLIC_URL: 'https://media.example.com',
      }).media,
    ).toBe(true);
  });

  it('requires a webhook and explicit approver for group approvals', () => {
    const env = {
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_CHAT_ID: '-123',
      TELEGRAM_WEBHOOK_SECRET: 'secret',
    };
    expect(getSetupEnvironmentStatus(env).telegramApproval).toBe(false);
    expect(
      getSetupEnvironmentStatus({ ...env, TELEGRAM_APPROVER_USER_ID: '456' })
        .telegramApproval,
    ).toBe(true);
    expect(
      getSetupEnvironmentStatus({ ...env, TELEGRAM_CHAT_ID: '456' })
        .telegramApproval,
    ).toBe(true);
    expect(
      getSetupEnvironmentStatus({
        ...env,
        TELEGRAM_CHAT_ID: '456',
        TELEGRAM_WEBHOOK_SECRET: undefined,
      }).telegramApproval,
    ).toBe(false);
  });
});
