import { customAlphabet } from "nanoid";

// Generate alphanumeric codes only (easier to read and type)
const nanoid = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10);

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function generateInviteCode(): string {
  return nanoid();
}

export async function generateUniqueInviteCode(
  checkExists: (code: string) => Promise<boolean>
): Promise<string> {
  let code = generateInviteCode();
  let attempts = 0;
  const maxAttempts = 10;
  
  while (await checkExists(code) && attempts < maxAttempts) {
    code = generateInviteCode();
    attempts++;
  }
  
  if (attempts >= maxAttempts) {
    throw new Error("Failed to generate unique invite code");
  }
  
  return code;
}
