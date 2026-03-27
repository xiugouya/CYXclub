// Password hashing using Web Crypto API (SHA-256 + salt)
// Lightweight, no external dependencies needed

const SALT_LENGTH = 16;
const ITERATIONS = 100000;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

// PBKDF2-based hashing using Web Crypto
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return toHex(derivedBits);
}

export async function hash(password: string): Promise<string> {
  const salt = generateSalt();
  const hashHex = await hashPassword(password, salt);
  const saltHex = toHex(salt);
  return `${saltHex}:${hashHex}`;
}

export async function verify(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const computedHash = await hashPassword(password, salt);
  // Constant-time comparison
  if (computedHash.length !== hashHex.length) return false;
  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return result === 0;
}
