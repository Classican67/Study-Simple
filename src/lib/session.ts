import "server-only";

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "fiches_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 jours

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error(
    "SESSION_SECRET manquant ou trop court (32 caractères minimum). " +
      "Génère-le avec : openssl rand -base64 32",
  );
}
const encodedKey = new TextEncoder().encode(secret);

export type SessionPayload = {
  userId: string;
  role: string;
};

// Les cookies Secure ne repartent pas du navigateur en clair HTTP. Servir l'app
// en HTTPS est le bon défaut (le service worker de la PWA l'exige de toute façon) ;
// COOKIE_SECURE=false reste l'échappatoire pour un accès LAN en http:// seul.
const useSecureCookie =
  process.env.COOKIE_SECURE === "false"
    ? false
    : process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(encodedKey);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

// Séparé de readSession() pour être appelable depuis le proxy, qui reçoit la
// requête et non le store de cookies.
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string" || typeof payload.role !== "string") return null;
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
