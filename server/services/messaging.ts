import { Resend } from 'resend';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_FROM = 'onboarding@resend.dev';

function toAbsoluteUrl(relativeUrl: string | null | undefined): string {
  if (!relativeUrl) return '';
  
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  
  const baseUrl = process.env.APP_BASE_URL || '';
  if (!baseUrl) {
    console.warn('[Email] APP_BASE_URL not set - images may not display in emails');
    return relativeUrl;
  }
  
  const cleanBase = baseUrl.replace(/\/$/, '');
  
  // Convert /uploads/file.png to /public/uploads/file.png for email clients
  let cleanPath = relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`;
  if (cleanPath.startsWith('/uploads/') && !cleanPath.startsWith('/public/uploads/')) {
    cleanPath = `/public${cleanPath}`;
  }
  
  return `${cleanBase}${cleanPath}`;
}

interface InlineAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  contentId: string;
}

function getImageFilePath(relativeUrl: string | null | undefined): string | null {
  if (!relativeUrl) return null;
  
  try {
    let pathname = relativeUrl;
    
    // Handle full URLs by extracting pathname
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
      const urlObj = new URL(relativeUrl);
      pathname = urlObj.pathname;
    }
    
    // Handle both /uploads/file.png and /public/uploads/file.png
    let filename = '';
    if (pathname.startsWith('/public/uploads/')) {
      filename = pathname.replace('/public/uploads/', '');
    } else if (pathname.startsWith('/uploads/')) {
      filename = pathname.replace('/uploads/', '');
    } else {
      console.warn(`[Email] Not a local upload path: ${relativeUrl}`);
      return null;
    }
    
    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      console.warn(`[Email] Invalid filename in URL: ${relativeUrl}`);
      return null;
    }
    
    // Check if file exists locally
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      console.warn(`[Email] Image file not found: ${filePath}`);
      return null;
    }
    
    return filePath;
  } catch (error: any) {
    console.warn(`[Email] Image path extraction failed: ${relativeUrl} - ${error.message}`);
    return null;
  }
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

function loadImageAsAttachment(
  relativeUrl: string | null | undefined,
  contentId: string
): InlineAttachment | null {
  const filePath = getImageFilePath(relativeUrl);
  if (!filePath) return null;
  
  try {
    const content = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const contentType = getContentType(filePath);
    
    console.log(`[Email] Loaded image for CID attachment: ${filename} (${contentType}, ${content.length} bytes)`);
    
    return {
      filename,
      content,
      contentType,
      contentId,
    };
  } catch (error: any) {
    console.warn(`[Email] Failed to read image file: ${filePath} - ${error.message}`);
    return null;
  }
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function normalizeFromAddress(rawFrom?: string): string {
  if (!rawFrom) {
    return DEFAULT_FROM;
  }

  const trimmed = rawFrom.trim();
  const emailOnlyRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const nameEmailRegex = /^[^<>]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/;

  if (emailOnlyRegex.test(trimmed) || nameEmailRegex.test(trimmed)) {
    return trimmed;
  }

  return DEFAULT_FROM;
}

function normalizePhoneToE164(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, '');
  
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`;
  } else {
    return `+${digitsOnly}`;
  }
}

export async function sendCampaignEmail({
  to,
  subject,
  body,
  companyName,
}: {
  to: string;
  subject: string;
  body: string;
  companyName: string;
}): Promise<EmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    console.error('[Campaign] RESEND_API_KEY not configured');
    return {
      success: false,
      error: 'Email service not configured - RESEND_API_KEY missing',
    };
  }

  const resend = new Resend(resendApiKey);
  const resolvedFrom = normalizeFromAddress(process.env.EMAIL_FROM);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #2563eb 0%, #059669 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">ECOLOGIC</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">${companyName}</p>
      </div>
      
      <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <div style="white-space: pre-wrap;">${body}</div>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
        <p style="margin: 0;">Sent by ${companyName}</p>
        <p style="margin: 8px 0 0 0; font-size: 11px;">To unsubscribe, please reply to this email or contact ${companyName} directly.</p>
      </div>
    </body>
    </html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: resolvedFrom,
      to: [to],
      subject,
      html,
    });

    if (error) {
      console.error('[Campaign] Resend API error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email via Resend',
      };
    }

    console.log('[Campaign] Email sent to=', to, 'id=', data?.id);
    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err: any) {
    console.error('[Campaign] Email failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to send email',
    };
  }
}

export async function sendCampaignSms({
  to,
  body,
}: {
  to: string;
  body: string;
}): Promise<SmsResult> {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!twilioAccountSid || !twilioAuthToken || !twilioFromNumber) {
    console.error('[Campaign] Twilio credentials not configured');
    return {
      success: false,
      error: 'SMS service not configured - Twilio credentials missing',
    };
  }

  const digitsOnly = to.replace(/\D/g, '');
  if (digitsOnly.length < 10) {
    return {
      success: false,
      error: 'Invalid phone number - must have at least 10 digits',
    };
  }

  const e164Phone = normalizePhoneToE164(to);

  try {
    const twilio = await import('twilio');
    const twilioClient = twilio.default(twilioAccountSid, twilioAuthToken);

    const message = await twilioClient.messages.create({
      body,
      from: twilioFromNumber,
      to: e164Phone,
    });

    console.log('[Campaign] SMS sent to=', e164Phone, 'sid=', message.sid);
    return {
      success: true,
      messageId: message.sid,
    };
  } catch (err: any) {
    console.error('[Campaign] SMS failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to send SMS',
    };
  }
}

export async function sendBrandedCampaignEmail({
  to,
  subject,
  body,
  companyName,
  branding,
  company,
}: {
  to: string;
  subject: string;
  body: string;
  companyName: string;
  branding?: {
    headerBannerUrl?: string | null;
    headerBackgroundType?: string | null;
    primaryColor?: string | null;
    fromName?: string | null;
    replyToEmail?: string | null;
    footerText?: string | null;
    showPhone?: boolean | null;
    showAddress?: boolean | null;
  } | null;
  company?: {
    phone?: string | null;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
  } | null;
}): Promise<EmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    console.error('[Campaign] RESEND_API_KEY not configured');
    return {
      success: false,
      error: 'Email service not configured - RESEND_API_KEY missing',
    };
  }

  const resend = new Resend(resendApiKey);
  const resolvedFrom = normalizeFromAddress(process.env.EMAIL_FROM);
  
  const brandColor = branding?.primaryColor || '#2563EB';
  const footerText = branding?.footerText || '';
  const fromName = branding?.fromName || companyName;
  
  // Load header image as CID inline attachment for reliable Gmail display
  const attachments: Array<{
    filename: string;
    content: string;
    contentId: string;
  }> = [];
  
  // Only load header image if background type is image
  const useImageHeader = branding?.headerBackgroundType === 'image' && branding?.headerBannerUrl;
  const headerAttachment = useImageHeader ? loadImageAsAttachment(branding?.headerBannerUrl, 'header') : null;
  const hasHeader = !!headerAttachment;
  
  if (headerAttachment) {
    attachments.push({
      filename: headerAttachment.filename,
      content: headerAttachment.content.toString('base64'),
      contentId: 'header',
    });
    console.log('[Campaign] Header image attached with contentId: header');
  }
  
  console.log('[Campaign] Sending email with', attachments.length, 'inline attachments, hasHeader:', hasHeader);
  
  const showPhone = branding?.showPhone ?? true;
  const showAddress = branding?.showAddress ?? true;
  
  const footerParts: string[] = [];
  if (showPhone && company?.phone) {
    footerParts.push(`Phone: ${company.phone}`);
  }
  if (showAddress && company?.addressLine1) {
    const addr = [company.addressLine1, company.city, company.state, company.postalCode].filter(Boolean).join(', ');
    footerParts.push(addr);
  }
  if (footerText) {
    footerParts.push(footerText);
  }
  
  // Build HTML - header image or solid color bar
  let headerHtml = '';
  
  if (hasHeader) {
    // Header image
    headerHtml = `
          <tr>
            <td style="padding: 0; line-height: 0;">
              <img src="cid:header" alt="${fromName}" width="600" style="width: 100%; max-width: 600px; height: auto; display: block; border-radius: 8px 8px 0 0;" />
            </td>
          </tr>`;
  } else {
    // Solid color header bar with company name
    headerHtml = `
          <tr>
            <td style="height: 120px; background-color: ${brandColor}; text-align: center; vertical-align: middle; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: white; font-size: 24px; font-weight: 600; letter-spacing: 1px;">${fromName}</h1>
            </td>
          </tr>`;
  }
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; max-width: 100%;">
          ${headerHtml}
          <tr>
            <td style="padding: 30px;">
              <div style="white-space: pre-wrap; color: #333333; line-height: 1.6;">${body}</div>
            </td>
          </tr>
          ${footerParts.length > 0 ? `
          <tr>
            <td style="padding: 20px 30px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #888888; font-size: 12px; text-align: center; line-height: 1.8;">
                ${footerParts.join('<br />')}
              </p>
              <p style="margin: 8px 0 0 0; color: #9ca3af; font-size: 11px; text-align: center;">
                To unsubscribe, please reply to this email or contact ${companyName} directly.
              </p>
            </td>
          </tr>
          ` : `
          <tr>
            <td style="padding: 20px 30px; background-color: #f8f9fa; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; color: #9ca3af; font-size: 11px; text-align: center;">
                Sent by ${companyName}. To unsubscribe, please reply to this email.
              </p>
            </td>
          </tr>
          `}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const { data, error } = await resend.emails.send({
      from: resolvedFrom,
      to: [to],
      subject,
      html,
      replyTo: branding?.replyToEmail || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (error) {
      console.error('[Campaign] Resend API error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email via Resend',
      };
    }

    console.log('[Campaign] Branded email sent to=', to, 'id=', data?.id);
    return {
      success: true,
      messageId: data?.id,
    };
  } catch (err: any) {
    console.error('[Campaign] Email failed:', err?.message || err);
    return {
      success: false,
      error: err?.message || 'Failed to send email',
    };
  }
}

export const messagingService = {
  sendEmail: async ({
    to,
    subject,
    html,
    replyTo,
    fromName,
  }: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
    fromName?: string;
  }): Promise<EmailResult> => {
    const resendApiKey = process.env.RESEND_API_KEY;
    
    if (!resendApiKey) {
      return {
        success: false,
        error: 'Email service not configured - RESEND_API_KEY missing',
      };
    }

    const resend = new Resend(resendApiKey);
    const baseFrom = normalizeFromAddress(process.env.EMAIL_FROM);
    
    try {
      const { data, error } = await resend.emails.send({
        from: baseFrom,
        to: [to],
        subject,
        html,
        replyTo: replyTo || undefined,
      });

      if (error) {
        return {
          success: false,
          error: error.message || 'Failed to send email via Resend',
        };
      }

      return {
        success: true,
        messageId: data?.id,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Failed to send email',
      };
    }
  },
  
  sendCampaignEmail,
  sendBrandedCampaignEmail,
  sendCampaignSms,
};
