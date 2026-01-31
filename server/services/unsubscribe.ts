import crypto from 'crypto';

const UNSUB_SECRET = process.env.SESSION_SECRET;
const TOKEN_EXPIRY_DAYS = 180;

if (!UNSUB_SECRET) {
  console.warn('[Unsub] WARNING: SESSION_SECRET not set - unsubscribe tokens will not work');
}

interface UnsubscribePayload {
  companyId: number;
  customerId: number;
  channel: 'email' | 'sms';
  issuedAt: number;
}

export function createUnsubscribeToken(payload: Omit<UnsubscribePayload, 'issuedAt'>): string {
  if (!UNSUB_SECRET) {
    throw new Error('SESSION_SECRET not configured - cannot create unsubscribe tokens');
  }
  
  const data: UnsubscribePayload = {
    ...payload,
    issuedAt: Date.now(),
  };
  
  const payloadStr = JSON.stringify(data);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const signature = crypto
    .createHmac('sha256', UNSUB_SECRET)
    .update(payloadB64)
    .digest('base64url');
  
  return `${payloadB64}.${signature}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  if (!UNSUB_SECRET) {
    console.error('[Unsub] SESSION_SECRET not configured - cannot verify tokens');
    return null;
  }
  
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      console.log('[Unsub] Invalid token format');
      return null;
    }
    
    const [payloadB64, signature] = parts;
    
    const expectedSignature = crypto
      .createHmac('sha256', UNSUB_SECRET)
      .update(payloadB64)
      .digest('base64url');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      console.log('[Unsub] Invalid token signature');
      return null;
    }
    
    const payloadStr = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload: UnsubscribePayload = JSON.parse(payloadStr);
    
    const expiryMs = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - payload.issuedAt > expiryMs) {
      console.log('[Unsub] Token expired');
      return null;
    }
    
    return payload;
  } catch (error) {
    console.error('[Unsub] Token verification error:', error);
    return null;
  }
}

export function generateUnsubscribeUrl(companyId: number, customerId: number, channel: 'email' | 'sms' = 'email'): string {
  const token = createUnsubscribeToken({ companyId, customerId, channel });
  const baseUrl = process.env.APP_BASE_URL || '';
  return `${baseUrl}/api/public/unsubscribe/${channel}?token=${encodeURIComponent(token)}`;
}
