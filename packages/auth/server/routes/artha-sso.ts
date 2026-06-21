import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { createUser } from '@documenso/lib/server-only/user/create-user';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';
import { Hono } from 'hono';

import { onAuthorize } from '../lib/utils/authorizer';
import type { HonoAuthContext } from '../types/context';

const base64UrlToBuffer = (value: string): Buffer => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(padded, 'base64');
};

const base64UrlEncode = (value: Buffer): string =>
  value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Artha Business OS single sign-on hand-off.
 *
 * The Artha CRM is the suite's identity provider: it mints a short-lived
 * HMAC-signed token for the logged-in user and redirects here. This route
 * verifies the signature against the shared secret, provisions the matching
 * user on first hand-off, and issues a normal Artha Sign session — no second
 * password prompt. A no-op (redirect to /signin) until ARTHA_SSO_SECRET is set.
 */
export const arthaSsoRoute = new Hono<HonoAuthContext>().get('/sso', async (c) => {
  const secret = env('ARTHA_SSO_SECRET') ?? '';
  const token = c.req.query('artha_sso') ?? '';

  if (!secret || !token) {
    return c.redirect('/signin');
  }

  const parts = token.split('.');

  if (parts.length !== 2) {
    return c.text('Invalid token', 403);
  }

  const [encodedPayload, signature] = parts;

  const expectedSignature = base64UrlEncode(createHmac('sha256', secret).update(encodedPayload).digest());

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return c.text('Invalid signature', 403);
  }

  let payload: { iss?: string; email?: string; name?: string; exp?: number };

  try {
    payload = JSON.parse(base64UrlToBuffer(encodedPayload).toString('utf-8'));
  } catch {
    return c.text('Invalid payload', 403);
  }

  if (payload.iss !== 'crm') {
    return c.text('Invalid issuer', 403);
  }

  const now = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp < now) {
    return c.text('Token expired', 403);
  }

  if (!payload.email) {
    return c.text('Invalid payload', 403);
  }

  const email = payload.email.toLowerCase();

  let user = await prisma.user.findFirst({ where: { email } });

  if (!user) {
    user = await createUser({
      name: payload.name || email,
      email,
      password: randomBytes(32).toString('hex'),
    });
  }

  await onAuthorize({ userId: user.id }, c);

  return c.redirect('/');
});
