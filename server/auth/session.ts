import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../shared/errors.js';

/**
 * Session authentication boundary (MASTER_PROMPT §3.5, §10.2 SEC1–SEC4).
 *
 * Two verifiers, one contract:
 *  - `firebase`      — the locked production verifier: Firebase ID tokens via firebase-admin.
 *  - `sandbox-hmac`  — a real HMAC-SHA256 token verifier used only when no Firebase credentials
 *                      exist and the process is NOT production. It exists so the whole spine is
 *                      provable in-sandbox with zero external credentials (§3.1, §1.4-4); it is
 *                      never constructed in production and it is not a stub: tokens carry an
 *                      expiry and a signature that is checked in constant time.
 *
 * No client-supplied identity is trusted: `firebaseUid` derives exclusively from a verified
 * token, never from a request body or header (§3.5, §10.2).
 */

export interface VerifiedIdentity {
  readonly firebaseUid: string;
  readonly email: string;
  readonly displayName: string;
}

export type VerifierKind = 'firebase' | 'sandbox-hmac';

export interface TokenVerifier {
  readonly kind: VerifierKind;
  verify(idToken: string): Promise<VerifiedIdentity>;
}

export const SANDBOX_TOKEN_PREFIX = 'sbx1';

/** Reject pathological inputs before any crypto work. */
const MAX_TOKEN_LENGTH = 4096;

interface SandboxTokenPayload {
  readonly uid: string;
  readonly email: string;
  readonly name: string;
  readonly exp: number;
}

function signSandboxPayload(secret: string, prefix: string, payloadB64: string): string {
  return createHmac('sha256', secret).update(`${prefix}.${payloadB64}`).digest('hex');
}

/**
 * Issues a signed sandbox token. `ttlMs` is explicit — there is no implicit eternal session.
 */
export function issueSandboxToken(params: {
  readonly identity: VerifiedIdentity;
  readonly secret: string;
  readonly ttlMs: number;
  readonly nowMs?: number;
}): string {
  if (params.secret.length < 16) {
    throw new AppError('INTERNAL_ERROR', {
      userMessage: 'The sandbox session secret must be at least 16 characters.',
    });
  }
  const now = params.nowMs ?? Date.now();
  const payload: SandboxTokenPayload = {
    uid: params.identity.firebaseUid,
    email: params.identity.email,
    name: params.identity.displayName,
    exp: Math.floor((now + params.ttlMs) / 1000),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signSandboxPayload(params.secret, SANDBOX_TOKEN_PREFIX, payloadB64);
  return `${SANDBOX_TOKEN_PREFIX}.${payloadB64}.${signature}`;
}

function decodeSandboxPayload(payloadB64: string): SandboxTokenPayload | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof decoded !== 'object' || decoded === null) return null;
  const candidate = decoded as { readonly uid?: unknown; readonly email?: unknown; readonly name?: unknown; readonly exp?: unknown };
  if (typeof candidate.uid !== 'string' || candidate.uid.length === 0) return null;
  if (typeof candidate.email !== 'string' || candidate.email.length === 0) return null;
  if (typeof candidate.name !== 'string') return null;
  if (typeof candidate.exp !== 'number' || !Number.isFinite(candidate.exp)) return null;
  return { uid: candidate.uid, email: candidate.email, name: candidate.name, exp: candidate.exp };
}

export function createSandboxTokenVerifier(params: {
  readonly secret: string;
  readonly nowMs?: () => number;
}): TokenVerifier {
  const clock = params.nowMs ?? (() => Date.now());
  return {
    kind: 'sandbox-hmac',
    async verify(idToken: string): Promise<VerifiedIdentity> {
      if (idToken.length === 0 || idToken.length > MAX_TOKEN_LENGTH) {
        throw new AppError('TOKEN_INVALID');
      }
      const parts = idToken.split('.');
      if (parts.length !== 3 || parts[0] !== SANDBOX_TOKEN_PREFIX) {
        throw new AppError('TOKEN_INVALID', { userMessage: 'The session token is malformed.' });
      }
      const [, payloadB64 = '', signature = ''] = parts;

      const expected = signSandboxPayload(params.secret, SANDBOX_TOKEN_PREFIX, payloadB64);
      const expectedBuf = Buffer.from(expected, 'hex');
      const actualBuf = Buffer.from(signature, 'hex');
      if (
        expectedBuf.length !== actualBuf.length ||
        !timingSafeEqual(expectedBuf, actualBuf)
      ) {
        throw new AppError('TOKEN_INVALID', { userMessage: 'The session token signature is invalid.' });
      }

      const payload = decodeSandboxPayload(payloadB64);
      if (payload === null) {
        throw new AppError('TOKEN_INVALID', { userMessage: 'The session token payload is invalid.' });
      }
      if (payload.exp * 1000 <= clock()) {
        throw new AppError('TOKEN_INVALID', {
          userMessage: 'The session token has expired.',
          details: { reason: 'EXPIRED' },
        });
      }

      return {
        firebaseUid: payload.uid,
        email: payload.email,
        displayName: payload.name.length > 0 ? payload.name : payload.email,
      };
    },
  };
}

export interface FirebaseSessionConfig {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKey: string;
}

/**
 * Production verifier. Cannot execute in this sandbox (no Firebase credentials), so it is
 * recorded as EXISTS_UNVERIFIED in TASKBOARD and exercised by CI once secrets exist (§8.5).
 */
export async function createFirebaseTokenVerifier(config: FirebaseSessionConfig): Promise<TokenVerifier> {
  const { cert, getApps, initializeApp } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');

  const existing = getApps();
  const app =
    existing.length > 0
      ? existing[0]!
      : initializeApp({
          credential: cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            privateKey: config.privateKey.replace(/\\n/g, '\n'),
          }),
        });
  const auth = getAuth(app);

  return {
    kind: 'firebase',
    async verify(idToken: string): Promise<VerifiedIdentity> {
      try {
        const decoded = await auth.verifyIdToken(idToken, true);
        const email = decoded.email ?? '';
        return {
          firebaseUid: decoded.uid,
          email: email.length > 0 ? email : `${decoded.uid}@firebase.invalid`,
          displayName: decoded.name ?? (email.length > 0 ? email : 'Signed-in user'),
        };
      } catch (error) {
        throw new AppError('TOKEN_INVALID', {
          userMessage: 'Firebase rejected the session token (expired, revoked, or forged).',
          details: { reason: error instanceof Error ? error.name : 'UNKNOWN' },
        });
      }
    },
  };
}

export interface SessionEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly FIREBASE_PROJECT_ID?: string | undefined;
  readonly FIREBASE_CLIENT_EMAIL?: string | undefined;
  readonly FIREBASE_PRIVATE_KEY?: string | undefined;
  readonly SANDBOX_AUTH_SECRET?: string | undefined;
}

export interface ResolvedVerifier {
  readonly verifier: TokenVerifier;
  readonly sandboxSecret: string | null;
  readonly note: string;
}

/**
 * Environment resolution — fails closed. A production process without Firebase credentials
 * gets NO verifier at all rather than a permissive fallback (§10.2, never trust the client).
 */
export async function resolveTokenVerifier(env: SessionEnvironment): Promise<ResolvedVerifier> {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    const verifier = await createFirebaseTokenVerifier({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY,
    });
    return { verifier, sandboxSecret: null, note: 'firebase-id-token' };
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_VERIFIER_MISSING: production requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
    );
  }

  const secret = env.SANDBOX_AUTH_SECRET ?? randomBytes(32).toString('hex');
  const ephemeral = env.SANDBOX_AUTH_SECRET === undefined;
  return {
    verifier: createSandboxTokenVerifier({ secret }),
    sandboxSecret: secret,
    note: ephemeral ? 'sandbox-hmac-ephemeral-secret' : 'sandbox-hmac-configured-secret',
  };
}

export interface SessionRequest extends Request {
  session?: VerifiedIdentity;
}

export function requireSession(req: Request): VerifiedIdentity {
  const identity = (req as SessionRequest).session;
  if (identity === undefined) {
    throw new AppError('SESSION_REQUIRED');
  }
  return identity;
}

/**
 * Express middleware: `Authorization: Bearer <token>` → verified identity → `req.session`.
 * Missing header is SESSION_REQUIRED (401); any verification failure is TOKEN_INVALID (401).
 */
export function createSessionMiddleware(verifier: TokenVerifier): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    if (header === undefined || header.trim().length === 0) {
      next(new AppError('SESSION_REQUIRED'));
      return;
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match === null || match[1] === undefined || match[1].trim().length === 0) {
      next(new AppError('SESSION_REQUIRED', { userMessage: 'The Authorization header is malformed.' }));
      return;
    }
    verifier
      .verify(match[1].trim())
      .then((identity) => {
        (req as SessionRequest).session = identity;
        next();
      })
      .catch((error: unknown) => {
        next(error instanceof AppError ? error : new AppError('TOKEN_INVALID'));
      });
  };
}
