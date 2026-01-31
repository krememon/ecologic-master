import { Resend } from 'resend';

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

async function isImagePubliclyAccessible(url: string): Promise<boolean> {
  if (!url) return false;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    const contentType = response.headers.get('content-type') || '';
    const isImage = contentType.startsWith('image/');
    const isAccessible = response.ok && isImage;
    
    if (!isAccessible) {
      console.warn(`[Email] Image not accessible: ${url} - status=${response.status} contentType=${contentType}`);
    }
    
    return isAccessible;
  } catch (error: any) {
    console.warn(`[Email] Image accessibility check failed: ${url} - ${error.message}`);
    return false;
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
    logoUrl?: string | null;
    headerBannerUrl?: string | null;
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
  let logoUrl = toAbsoluteUrl(branding?.logoUrl);
  let headerBannerUrl = toAbsoluteUrl(branding?.headerBannerUrl);
  const footerText = branding?.footerText || '';
  const fromName = branding?.fromName || companyName;
  
  // Log URLs for debugging
  console.log('[Campaign] Raw branding URLs:', { 
    rawLogo: branding?.logoUrl, 
    rawHeader: branding?.headerBannerUrl 
  });
  console.log('[Campaign] Absolute URLs for email:', { logoUrl, headerBannerUrl });
  
  // Check if images are publicly accessible, skip if not
  if (logoUrl) {
    const isLogoAccessible = await isImagePubliclyAccessible(logoUrl);
    if (!isLogoAccessible) {
      console.warn('[Campaign] Logo not publicly accessible, skipping in email:', logoUrl);
      logoUrl = '';
    }
  }
  
  if (headerBannerUrl) {
    const isHeaderAccessible = await isImagePubliclyAccessible(headerBannerUrl);
    if (!isHeaderAccessible) {
      console.warn('[Campaign] Header banner not publicly accessible, skipping in email:', headerBannerUrl);
      headerBannerUrl = '';
    }
  }
  
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
          ${headerBannerUrl ? `
          <tr>
            <td style="padding: 0;">
              <img src="${headerBannerUrl}" alt="Header" style="width: 100%; height: auto; display: block;" />
            </td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 30px; background-color: ${brandColor}; text-align: center;">
              ${logoUrl ? `<img src="${logoUrl}" alt="${fromName}" style="max-height: 60px; max-width: 200px;" />` : `<h1 style="margin: 0; color: white; font-size: 24px;">${fromName}</h1>`}
            </td>
          </tr>
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
