// Client-side password stretching parameters. The browser derives a 32-byte key
// with PBKDF2-SHA256 and only that key is sent to the API (see api/src/auth.ts).
// Changing these values invalidates every existing password.

export const PBKDF2_ITERATIONS = 600_000;

export function passwordSalt(email: string): string {
  return `pokevault:v1:${email.trim().toLowerCase()}`;
}

export const MIN_PASSWORD_LENGTH = 8;
