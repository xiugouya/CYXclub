// Admin seed script
// Run with: npx tsx scripts/seed-admin.ts
// Generates the PBKDF2 hash for admin password and outputs the SQL to insert

const SALT_LENGTH = 16;
const ITERATIONS = 100000;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

async function main() {
  const password = 'cyx2026admin';
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hashHex = await hashPassword(password, salt);
  const saltHex = toHex(salt);
  const fullHash = `${saltHex}:${hashHex}`;

  console.log('Admin password hash generated:');
  console.log(fullHash);
  console.log('\nSQL to run:');
  console.log(`UPDATE users SET password_hash = '${fullHash}' WHERE username = 'admin';`);
  console.log('\nOr run via wrangler:');
  console.log(`wrangler d1 execute cyx-club-db --command "UPDATE users SET password_hash = '${fullHash}' WHERE username = 'admin';"`);
}

main().catch(console.error);
