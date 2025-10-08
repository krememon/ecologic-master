/**
 * Phone number utilities for validation, formatting, and normalization
 */

/**
 * Normalize phone number to E.164 format when possible
 * E.164: +[country code][number] e.g., +16315551234
 * Falls back to sanitized raw input if parsing fails
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters except leading + and x (for extensions)
  const cleaned = phone.replace(/[^\d+x]/gi, '');
  
  // If it starts with +, it might already be E.164
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // Extract digits only for length check
  const digitsOnly = cleaned.replace(/[^0-9]/g, '');
  
  // US number normalization (10 or 11 digits)
  if (digitsOnly.length === 10) {
    // Assume US number, add +1
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // Already has country code
    return `+${digitsOnly}`;
  }
  
  // For other formats, return cleaned version with + prefix if not present
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Format phone number for display
 * US numbers: (631) 555-1234
 * International: +[country code] [number]
 */
export function formatPhone(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');
  
  // Check if it's a US number (+1 followed by 10 digits)
  const usMatch = cleaned.match(/^\+?1?(\d{3})(\d{3})(\d{4})$/);
  if (usMatch) {
    return `(${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;
  }
  
  // For international numbers, format as +XX XXXXXXXXXX
  if (cleaned.startsWith('+')) {
    const countryCode = cleaned.slice(0, cleaned.length > 10 ? -10 : 3);
    const number = cleaned.slice(countryCode.length);
    return `${countryCode} ${number}`;
  }
  
  // Return cleaned version if no pattern matches
  return cleaned;
}

/**
 * Validate phone number
 * Must be 7-20 characters after stripping non-digits (except leading + and x)
 */
export function validatePhone(phone: string): boolean {
  if (!phone) return true; // Phone is optional
  
  // Strip all non-digits except leading + and x
  const cleaned = phone.replace(/[^\d+x]/gi, '');
  const digitsOnly = cleaned.replace(/[^0-9]/g, '');
  
  // Check length (7-20 digits)
  return digitsOnly.length >= 7 && digitsOnly.length <= 20;
}

/**
 * Format phone as user types (US format with mask)
 * Returns formatted value suitable for input display
 */
export function formatPhoneInput(value: string): string {
  if (!value) return '';
  
  // Remove all non-numeric characters
  const numbers = value.replace(/\D/g, '');
  
  // Handle international format (starts with +)
  if (value.trim().startsWith('+')) {
    return '+' + numbers;
  }
  
  // US format: (XXX) XXX-XXXX
  const match = numbers.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (match) {
    if (!match[1]) return '';
    if (!match[2]) return match[1];
    if (!match[3]) return `(${match[1]}) ${match[2]}`;
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }
  
  return value;
}

/**
 * Get raw phone number value from formatted input
 * Removes formatting but preserves + for international
 */
export function getRawPhoneValue(formatted: string): string {
  if (!formatted) return '';
  
  // Preserve + at the start for international numbers
  if (formatted.trim().startsWith('+')) {
    return '+' + formatted.replace(/\D/g, '');
  }
  
  // For US numbers, just return digits
  return formatted.replace(/\D/g, '');
}
