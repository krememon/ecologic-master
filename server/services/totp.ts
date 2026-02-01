import crypto from "crypto";
import speakeasy from "speakeasy";
import QRCode from "qrcode";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.TOTP_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("TOTP_ENCRYPTION_KEY environment variable is required");
  }
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes (base64 encoded)");
  }
  return decoded;
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  
  const authTag = cipher.getAuthTag();
  
  return Buffer.concat([iv, authTag, Buffer.from(encrypted, "base64")]).toString("base64");
}

export function decrypt(ciphertext: string): string {
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

export function generateSecret(userEmail: string, issuer: string = "EcoLogic"): {
  secret: string;
  otpauthUrl: string;
} {
  const generated = speakeasy.generateSecret({
    name: `${issuer}:${userEmail}`,
    issuer,
    length: 20,
  });
  
  return {
    secret: generated.base32,
    otpauthUrl: generated.otpauth_url!,
  };
}

export async function generateQRCode(otpauthUrl: string): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    width: 200,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
}

export function verifyToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1,
  });
}

export function generateBackupCodes(count: number = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
    codes.push(formatted);
  }
  return codes;
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}

export function verifyBackupCode(code: string, hashedCodes: string[]): { valid: boolean; index: number } {
  const normalizedCode = code.replace(/-/g, "").toUpperCase();
  const hashedInput = crypto.createHash("sha256").update(normalizedCode).digest("hex");
  
  const index = hashedCodes.findIndex(h => h === hashedInput);
  return {
    valid: index !== -1,
    index,
  };
}
