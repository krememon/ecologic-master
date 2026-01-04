import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const DEFAULT_FROM = 'onboarding@resend.dev';

function normalizeFromAddress(rawFrom?: string): string {
  if (!rawFrom) {
    console.warn('[Email] EMAIL_FROM not set, using fallback:', DEFAULT_FROM);
    return DEFAULT_FROM;
  }

  const trimmed = rawFrom.trim();

  const emailOnlyRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const nameEmailRegex = /^[^<>]+<[^\s@]+@[^\s@]+\.[^\s@]+>$/;

  if (emailOnlyRegex.test(trimmed)) {
    return trimmed;
  }
  
  if (nameEmailRegex.test(trimmed)) {
    return trimmed;
  }

  console.warn('[Email] Invalid EMAIL_FROM format, using fallback:', DEFAULT_FROM, '(was:', trimmed, ')');
  return DEFAULT_FROM;
}

interface SignatureRequestEmailParams {
  to: string;
  customerName: string;
  documentName: string;
  signUrl: string;
  message?: string;
  companyName: string;
}

export async function sendSignatureRequestEmail({
  to,
  customerName,
  documentName,
  signUrl,
  message,
  companyName,
}: SignatureRequestEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured. Please add it to your secrets.');
  }
  
  const resolvedFrom = normalizeFromAddress(process.env.EMAIL_FROM);

  console.log('[Email] From:', resolvedFrom);
  console.log('[Email] To:', to);

  const messageBlock = message 
    ? `<div style="background-color: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; color: #495057; font-style: italic;">"${message}"</p>
      </div>`
    : '';

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
        <h2 style="margin: 0 0 20px 0; color: #1f2937;">Signature Requested</h2>
        
        <p style="margin: 0 0 16px 0;">Hello ${customerName},</p>
        
        <p style="margin: 0 0 16px 0;">You have been requested to review and sign the following document:</p>
        
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-weight: 600; color: #1f2937;">${documentName}</p>
        </div>
        
        ${messageBlock}
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${signUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #059669 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Review & Sign Document</a>
        </div>
        
        <p style="margin: 16px 0 0 0; font-size: 14px; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="margin: 8px 0 0 0; font-size: 12px; word-break: break-all; color: #9ca3af;">${signUrl}</p>
      </div>
      
      <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
        <p style="margin: 0;">Sent by ${companyName} via EcoLogic</p>
      </div>
    </body>
    </html>
  `;

  try {
    const { data, error } = await resend.emails.send({
      from: resolvedFrom,
      to: [to],
      subject: `Signature requested: ${documentName}`,
      html,
    });

    if (error) {
      console.error('[Email] Resend API error:', error);
      throw new Error(error.message || 'Failed to send email via Resend');
    }

    console.log('[Email] delivered (Resend) to=', to, 'id=', data?.id);
  } catch (err: any) {
    console.error('[Email] failed:', err?.message || err);
    throw err;
  }
}

interface TestEmailParams {
  to: string;
}

export async function sendTestEmail({ to }: TestEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  
  if (!resendApiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  
  const resolvedFrom = normalizeFromAddress(process.env.EMAIL_FROM);

  console.log('[Email] Test email from:', resolvedFrom);
  console.log('[Email] Test email to:', to);

  const { data, error } = await resend.emails.send({
    from: resolvedFrom,
    to: [to],
    subject: 'EcoLogic - Test Email',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #2563eb;">Email Configuration Test</h1>
        <p>If you're seeing this, your email configuration is working correctly!</p>
        <p style="color: #6b7280; font-size: 14px;">Sent via Resend from EcoLogic</p>
      </div>
    `,
  });

  if (error) {
    console.error('[Email] test email failed:', error);
    throw new Error(error.message || 'Failed to send test email');
  }

  console.log('[Email] test email delivered to=', to, 'id=', data?.id);
}
