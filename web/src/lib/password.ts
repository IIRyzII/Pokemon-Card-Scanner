// Stretches a password into the 32-byte key the API expects (PBKDF2-SHA256).
// The plain password never leaves the device.

import { PBKDF2_ITERATIONS, passwordSalt } from '../../../shared/password.ts';

export async function derivePasswordKey(email: string, password: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure sign-in needs an https:// page (or localhost). Open the app from its GitHub Pages address.');
  }
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(passwordSalt(email)), iterations: PBKDF2_ITERATIONS },
    material,
    256,
  );
  let bin = '';
  for (const b of new Uint8Array(bits)) bin += String.fromCharCode(b);
  return btoa(bin);
}
