import { createHmac, timingSafeEqual } from 'node:crypto';
import { createFileRoute } from '@tanstack/react-router';

type MetaSignedRequestPayload = {
  algorithm?: string;
  issued_at?: number;
  user_id?: string;
  oauth_token?: string;
  expires?: number;
};

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function parseSignedRequest(signedRequest: string, appSecret: string): MetaSignedRequestPayload {
  const [encodedSignature, encodedPayload] = signedRequest.split('.', 2);
  if (!encodedSignature || !encodedPayload) {
    throw new Error('Invalid signed_request format');
  }

  const payloadBuffer = base64UrlToBuffer(encodedPayload);
  const payload = JSON.parse(payloadBuffer.toString('utf8')) as MetaSignedRequestPayload;
  if (payload.algorithm?.toUpperCase() !== 'HMAC-SHA256') {
    throw new Error('Unsupported signed_request algorithm');
  }

  const providedSignature = base64UrlToBuffer(encodedSignature);
  const expectedSignature = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new Error('Invalid signed_request signature');
  }

  return payload;
}

function getMetaAppSecret(): string {
  const appSecret = process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    throw new Error('Meta data deletion callback is not configured. Set META_APP_SECRET in the server environment.');
  }
  return appSecret;
}

function buildStatusUrl(request: Request, confirmationCode: string): string {
  const url = new URL('/data-deletion', request.url);
  url.searchParams.set('confirmation_code', confirmationCode);
  return url.toString();
}

export const Route = createFileRoute('/api/meta/data-deletion')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({
          ok: true,
          message: 'Meta data deletion callback endpoint is live. Configure this URL in the Meta app dashboard.',
        }),

      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const signedRequest = form.get('signed_request');
          if (typeof signedRequest !== 'string' || !signedRequest) {
            return Response.json({ error: 'Missing signed_request' }, { status: 400 });
          }

          const payload = parseSignedRequest(signedRequest, getMetaAppSecret());
          const confirmationCode = `${crypto.randomUUID()}-${payload.user_id ?? 'anonymous'}`;

          // Unheard does not currently map Meta login user IDs directly to internal workspace users.
          // We acknowledge the deletion request here and direct the user to the public deletion page.
          return Response.json({
            url: buildStatusUrl(request, confirmationCode),
            confirmation_code: confirmationCode,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid data deletion request';
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },
  },
});
