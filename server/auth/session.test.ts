import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors.js';
import {
  createSandboxTokenVerifier,
  createSessionMiddleware,
  issueSandboxToken,
  requireSession,
  resolveTokenVerifier,
  type SessionRequest,
  type VerifiedIdentity,
} from './session.js';

const SECRET = 'sandbox-secret-that-is-long-enough-0001';
const OTHER_SECRET = 'another-sandbox-secret-long-enough-002';
const IDENTITY: VerifiedIdentity = {
  firebaseUid: 'sandbox:owner@onefpa.test',
  email: 'owner@onefpa.test',
  displayName: 'Owner',
};

async function expectTokenInvalid(token: string, verifier = createSandboxTokenVerifier({ secret: SECRET })) {
  let caught: unknown = null;
  try {
    await verifier.verify(token);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe('TOKEN_INVALID');
  expect((caught as AppError).httpStatus).toBe(401);
  return caught as AppError;
}

describe('WI-0013 session verification boundary (SEC1, §3.5)', () => {
  it('issues a signed token that verifies back to the exact identity', async () => {
    const token = issueSandboxToken({ identity: IDENTITY, secret: SECRET, ttlMs: 60_000 });
    expect(token.startsWith('sbx1.')).toBe(true);
    const verified = await createSandboxTokenVerifier({ secret: SECRET }).verify(token);
    expect(verified).toEqual(IDENTITY);
  });

  it('rejects a forged signature, a foreign secret, and a tampered payload', async () => {
    const token = issueSandboxToken({ identity: IDENTITY, secret: SECRET, ttlMs: 60_000 });
    const [prefix, payload, signature] = token.split('.');
    expect(prefix).toBe('sbx1');

    const forged = `${prefix}.${payload}.${'0'.repeat((signature ?? '').length)}`;
    await expectTokenInvalid(forged);

    await expectTokenInvalid(token, createSandboxTokenVerifier({ secret: OTHER_SECRET }));

    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      uid: string;
      email: string;
      name: string;
      exp: number;
    };
    const escalated = Buffer.from(
      JSON.stringify({ ...decoded, uid: 'sandbox:attacker@onefpa.test' }),
      'utf8',
    ).toString('base64url');
    await expectTokenInvalid(`sbx1.${escalated}.${signature}`);
  });

  it('rejects an expired token with reason EXPIRED and accepts it just before expiry', async () => {
    const issuedAt = Date.parse('2026-11-25T10:00:00.000Z');
    const token = issueSandboxToken({
      identity: IDENTITY,
      secret: SECRET,
      ttlMs: 60_000,
      nowMs: issuedAt,
    });

    const before = createSandboxTokenVerifier({
      secret: SECRET,
      nowMs: () => issuedAt + 59_000,
    });
    await expect(before.verify(token)).resolves.toEqual(IDENTITY);

    const after = createSandboxTokenVerifier({
      secret: SECRET,
      nowMs: () => issuedAt + 60_000,
    });
    const error = await expectTokenInvalid(token, after);
    expect(error.details['reason']).toBe('EXPIRED');
  });

  it('rejects malformed, empty, oversized, and structurally invalid tokens without leaking detail', async () => {
    const verifier = createSandboxTokenVerifier({ secret: SECRET });
    const errors = [
      await expectTokenInvalid('', verifier),
      await expectTokenInvalid('not-a-token', verifier),
      await expectTokenInvalid('sbx1.only-two-parts', verifier),
      await expectTokenInvalid('wrong.abc.def', verifier),
      await expectTokenInvalid('x'.repeat(5000), verifier),
    ];
    expect(errors).toHaveLength(5);
    expect(errors.every((e) => e.code === 'TOKEN_INVALID' && e.httpStatus === 401)).toBe(true);
    expect(errors.every((e) => !e.message.includes('secret'))).toBe(true);
  });

  it('rejects a correctly signed token whose payload is not a valid identity document', async () => {
    const { createHmac } = await import('node:crypto');
    const sign = (payloadB64: string) =>
      createHmac('sha256', SECRET).update(`sbx1.${payloadB64}`).digest('hex');

    const notJson = Buffer.from('this-is-not-json', 'utf8').toString('base64url');
    const wrongTypes = Buffer.from(
      JSON.stringify({ uid: 'u', email: 'e', name: 'n', exp: 'soon' }),
      'utf8',
    ).toString('base64url');
    const missingEmail = Buffer.from(
      JSON.stringify({ uid: 'u', name: 'n', exp: 9_999_999_999 }),
      'utf8',
    ).toString('base64url');

    const errors = [
      await expectTokenInvalid(`sbx1.${notJson}.${sign(notJson)}`),
      await expectTokenInvalid(`sbx1.${wrongTypes}.${sign(wrongTypes)}`),
      await expectTokenInvalid(`sbx1.${missingEmail}.${sign(missingEmail)}`),
    ];
    expect(errors.map((e) => e.code)).toEqual(['TOKEN_INVALID', 'TOKEN_INVALID', 'TOKEN_INVALID']);
  });

  it('refuses to issue a token with a short secret (no weak signatures)', () => {
    expect(() => issueSandboxToken({ identity: IDENTITY, secret: 'short', ttlMs: 1000 })).toThrow(AppError);
  });

  it('resolves the verifier environment fail-closed: production without Firebase credentials refuses to start', async () => {
    await expect(resolveTokenVerifier({ NODE_ENV: 'production' })).rejects.toThrow('SESSION_VERIFIER_MISSING');

    const sandbox = await resolveTokenVerifier({ NODE_ENV: 'development' });
    expect(sandbox.verifier.kind).toBe('sandbox-hmac');
    expect(sandbox.sandboxSecret).not.toBeNull();
    expect(sandbox.note).toBe('sandbox-hmac-ephemeral-secret');

    const configured = await resolveTokenVerifier({
      NODE_ENV: 'test',
      SANDBOX_AUTH_SECRET: SECRET,
    });
    expect(configured.sandboxSecret).toBe(SECRET);
    expect(configured.note).toBe('sandbox-hmac-configured-secret');
  });
});

describe('WI-0013 session middleware (401 paths + identity attachment)', () => {
  function runMiddleware(
    verifier = createSandboxTokenVerifier({ secret: SECRET }),
    header?: string,
  ): Promise<{ readonly req: Request; readonly nextError: unknown }> {
    const middleware = createSessionMiddleware(verifier);
    const req = { header: (name: string) => (name.toLowerCase() === 'authorization' ? header : undefined) };
    const res = {};
    return new Promise((resolve) => {
      const next: NextFunction = (err?: unknown) => {
        resolve({ req: req as unknown as Request, nextError: err ?? null });
      };
      middleware(req as unknown as Request, res as unknown as Response, next);
    });
  }

  it('rejects a missing or malformed Authorization header with SESSION_REQUIRED', async () => {
    const missing = await runMiddleware();
    expect((missing.nextError as AppError).code).toBe('SESSION_REQUIRED');

    const malformed = await runMiddleware(undefined, 'Token abc');
    expect((malformed.nextError as AppError).code).toBe('SESSION_REQUIRED');

    const emptyBearer = await runMiddleware(undefined, 'Bearer    ');
    expect((emptyBearer.nextError as AppError).code).toBe('SESSION_REQUIRED');
  });

  it('attaches the verified identity to the request on success', async () => {
    const token = issueSandboxToken({ identity: IDENTITY, secret: SECRET, ttlMs: 60_000 });
    const result = await runMiddleware(undefined, `Bearer ${token}`);
    expect(result.nextError).toBeNull();
    expect((result.req as SessionRequest).session).toEqual(IDENTITY);
    expect(requireSession(result.req)).toEqual(IDENTITY);
  });

  it('forwards TOKEN_INVALID for a forged bearer token and attaches no identity', async () => {
    const result = await runMiddleware(undefined, 'Bearer sbx1.abc.def');
    expect((result.nextError as AppError).code).toBe('TOKEN_INVALID');
    expect((result.req as SessionRequest).session).toBeUndefined();
  });

  it('forwards TOKEN_INVALID when the verifier itself rejects with a non-AppError', async () => {
    const throwingVerifier = {
      kind: 'sandbox-hmac' as const,
      verify: () => Promise.reject(new Error('driver exploded with internal detail')),
    };
    const result = await runMiddleware(throwingVerifier, 'Bearer some-token');
    expect((result.nextError as AppError).code).toBe('TOKEN_INVALID');
    expect((result.nextError as AppError).message).not.toContain('driver exploded');
    expect((result.req as SessionRequest).session).toBeUndefined();
  });

  it('throws SESSION_REQUIRED from requireSession when no identity is attached', () => {
    expect(() => requireSession({ header: () => undefined } as unknown as Request)).toThrow(AppError);
  });
});
