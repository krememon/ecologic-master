import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is required for storing sensitive tokens");
  }
  let decoded: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    decoded = Buffer.from(key, "hex");
  } else {
    decoded = Buffer.from(key, "base64");
  }
  if (decoded.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (AES-256). Got ${decoded.length} bytes.`);
  }
  _cachedKey = decoded;
  return decoded;
}

try {
  const present = !!process.env.ENCRYPTION_KEY;
  console.log("[crypto] ENCRYPTION_KEY present:", present);
  if (present) {
    const raw = process.env.ENCRYPTION_KEY!.trim();
    let bytes: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      bytes = Buffer.from(raw, "hex");
    } else {
      bytes = Buffer.from(raw, "base64");
    }
    console.log("[crypto] ENCRYPTION_KEY decoded bytes:", bytes.length);
    if (bytes.length !== 32) {
      console.error("[crypto] WARNING: Key is not 32 bytes! Encryption will fail.");
    }
  }
} catch (e: any) {
  console.error("[crypto] Startup key check error:", e.message);
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, Buffer.from(encrypted, "base64")]).toString("base64");
}

export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, "base64");

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}

export function isEncryptionAvailable(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}
