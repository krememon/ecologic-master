import { Resend } from 'resend';

const DEFAULT_FROM = 'onboarding@resend.dev';

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
