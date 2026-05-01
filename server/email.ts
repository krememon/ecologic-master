import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export function getResendFrom(): string {
  const from = process.env.RESEND_FROM;
  if (!from) {
    console.warn('[email] RESEND_FROM not set');
    return 'EcoLogic <no-reply@ecologicc.com>';
  }
  return from;
}

// ── OTP / sign-in code email sender ──────────────────────────────────────────
//
// Single source of truth for sending the 6-digit codes used by signup +
// login. Replaces the 4 inline copies that previously lived in server/auth.ts
// (signup-code, signup-resend, login-password, login-resend).
//
// Why this helper exists (root-cause of the staging "no code arrived" bug):
//
//   The previous code did:
//       const { error } = await resend.emails.send({ ... })
//       if (error) { ... return 500 }
//       console.log("[login-code] Email sent successfully to:", to)
//
//   It threw away `data` (the Resend message id), and on failure logged the
//   raw error object — which Node prints as `{}` for many Resend errors,
//   making it impossible to tell from production logs whether Resend
//   rejected the send (unverified domain, sandbox mode, invalid recipient,
//   etc.) or accepted it but failed to deliver later.
//
//   Critically, "Resend returned no error" only means Resend QUEUED the
//   message — it does NOT mean the recipient's mailbox received it.
//   Bounces, spam-folder routing, and asynchronous rejections all happen
//   AFTER the API call returns success and were invisible.
//
// This helper:
//   • Always logs the FROM/TO and whether the API key is configured.
//   • On success, logs the Resend message id so it can be traced in the
//     Resend dashboard for real delivery status.
//   • On failure, logs JSON.stringify(error) so the actual reason
//     (`validation_error`, `not_found`, `restricted_api_key`, etc.) is
//     visible in deployment logs.
//   • Differentiates "accepted by Resend" from "delivered" in log text.
//   • If STAGING_LOG_OTP_CODES=true (or NODE_ENV !== 'production'), also
//     logs the plaintext 6-digit code so a developer can complete sign-in
//     from server logs while email-delivery issues are being resolved.
//     This is OFF by default in production.
export type OtpEmailContext =
  | 'signup-code'
  | 'signup-resend'
  | 'login-code'
  | 'login-resend';

export interface SendOtpEmailParams {
  to: string;
  code: string;
  context: OtpEmailContext;
  subject: string;
  /** Full HTML body. The 6-digit code should already be embedded by the caller. */
  html: string;
}

export type SendOtpEmailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; reason: string; details?: unknown };

function shouldLogOtpCode(): boolean {
  if (process.env.STAGING_LOG_OTP_CODES === 'true') return true;
  // Replit Deployments set NODE_ENV=production for both staging and prod, so
  // we only auto-log when not on a deployed environment.
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

export async function sendOtpEmail(
  params: SendOtpEmailParams,
): Promise<SendOtpEmailResult> {
  const { to, code, context, subject, html } = params;
  const tag = `[email/${context}]`;

  const apiKey = process.env.RESEND_API_KEY;
  const from = getResendFrom();

  console.log(
    `${tag} preparing send | to=${to} | from=${from} | apiKeyPresent=${!!apiKey} | subject="${subject}"`,
  );

  if (shouldLogOtpCode()) {
    // Diagnostic-only log so the user can complete sign-in from server logs
    // when email delivery is being investigated. Gated behind an env flag
    // (or non-production NODE_ENV) so this never fires on real production.
    console.log(`${tag} [DIAG] OTP code for ${to} = ${code}`);
  }

  if (!apiKey) {
    console.error(`${tag} RESEND_API_KEY is not configured`);
    return { ok: false, reason: 'email_provider_not_configured' };
  }

  try {
    const client = new Resend(apiKey);
    const { data, error } = await client.emails.send({
      from,
      reply_to: 'no-reply@ecologicc.com',
      to,
      subject,
      html,
    });

    if (error) {
      // Resend errors are objects like { name, message, statusCode } that
      // Node's default console.error prints as "{}". JSON.stringify gives
      // us the real fields so the cause is actually readable in logs.
      console.error(
        `${tag} Resend rejected send | to=${to} | from=${from} | error=${JSON.stringify(
          error,
        )}`,
      );
      return { ok: false, reason: 'resend_rejected', details: error };
    }

    const messageId = data?.id ?? null;
    console.log(
      `${tag} queued at Resend (delivery is asynchronous — check Resend dashboard for actual delivery status) | to=${to} | from=${from} | messageId=${messageId}`,
    );
    return { ok: true, messageId };
  } catch (err: any) {
    console.error(
      `${tag} Resend send threw | to=${to} | from=${from} | message=${
        err?.message ?? String(err)
      } | stack=${err?.stack ?? '(no stack)'}`,
    );
    return { ok: false, reason: 'resend_exception', details: err?.message ?? String(err) };
  }
}

export function getAppBaseUrl(): string | null {
  // Priority: canonical branded domain first, then legacy APP_BASE_URL
  const raw = (
    process.env.ECOLOGIC_PUBLIC_URL ||
    process.env.APP_PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    ''
  ).trim();

  if (!raw) {
    console.warn('[SignLink] No base URL env var set (checked ECOLOGIC_PUBLIC_URL, APP_PUBLIC_BASE_URL, APP_BASE_URL)');
    return null;
  }

  let normalized = raw;
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  try {
    const url = new URL(normalized);
    const base = url.origin;
    console.log('[SignLink] Using base URL =', base);
    return base;
  } catch (err) {
    console.warn('[SignLink] Invalid base URL:', raw);
    return null;
  }
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
  
  const resolvedFrom = getResendFrom();
  console.log('[email] FROM used:', resolvedFrom);
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
      <div style="padding: 40px 30px 32px 30px; border-radius: 12px 12px 0 0; text-align: center; background-color: #f0f4f8;">
        <h1 style="margin: 0; font-family: Inter, Arial, sans-serif; font-size: 40px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; line-height: 1;">EcoLogic</h1>
        <p style="margin: 8px 0 0 0; font-family: Inter, Arial, sans-serif; font-size: 15px; font-weight: 500; color: #64748b;">Professional contractor management</p>
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
      reply_to: 'no-reply@ecologicc.com',
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
  
  const resolvedFrom = getResendFrom();
  console.log('[email] FROM used:', resolvedFrom);
  console.log('[Email] Test email to:', to);

  const { data, error } = await resend.emails.send({
    from: resolvedFrom,
    reply_to: 'no-reply@ecologicc.com',
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

interface PaymentReceiptEmailParams {
  to: string;
  customerName: string;
  companyName: string;
  invoiceNumber: string;
  amountFormatted: string;
  paymentMethod: string;
  paidDate: string;
  pdfAttachment?: { filename: string; content: Buffer } | null;
  balanceRemainingFormatted?: string;
  isPartial?: boolean;
  discount?: {
    type: 'amount' | 'percent';
    value: number;
    amountCents: number;
    reason: string | null;
  };
}

export async function sendPaymentReceiptEmail({
  to,
  customerName,
  companyName,
  invoiceNumber,
  amountFormatted,
  paymentMethod,
  paidDate,
  pdfAttachment,
  balanceRemainingFormatted,
  isPartial,
  discount,
}: PaymentReceiptEmailParams): Promise<string | null> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.log('[ReceiptEmail] skipped — RESEND_API_KEY not configured');
    return null;
  }

  const resolvedFrom = getResendFrom();
  console.log('[email] FROM used:', resolvedFrom);

  const methodLabel: Record<string, string> = {
    cash: 'Cash',
    check: 'Check',
    credit_card: 'Credit Card',
    stripe: 'Credit Card (Stripe)',
    bank_transfer: 'Bank Transfer',
    other: 'Other',
  };
  const displayMethod = methodLabel[paymentMethod] || paymentMethod || 'N/A';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="padding: 40px 30px 32px 30px; border-radius: 12px 12px 0 0; text-align: center; background-color: #f0f4f8;">
        <h1 style="margin: 0; font-family: Inter, Arial, sans-serif; font-size: 40px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; line-height: 1;">EcoLogic</h1>
        <p style="margin: 8px 0 0 0; font-family: Inter, Arial, sans-serif; font-size: 15px; font-weight: 500; color: #64748b;">Professional contractor management</p>
      </div>

      <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="margin: 0 0 20px 0; color: #1f2937;">Payment Receipt</h2>

        <p style="margin: 0 0 16px 0;">Hello ${customerName},</p>

        <p style="margin: 0 0 20px 0;">Thank you for your payment${isPartial ? '' : ' — your paid invoice is attached'}.</p>

        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Invoice</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #1f2937;">${invoiceNumber}</td>
            </tr>
            ${discount && discount.amountCents > 0 ? `<tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">${discount.type === 'percent' ? `Discount (${discount.value}%)` : 'Discount'}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #059669; font-size: 14px;">-$${(discount.amountCents / 100).toFixed(2)}</td>
            </tr>${discount.reason ? `
            <tr>
              <td colspan="2" style="padding: 0 0 8px 0; color: #9ca3af; font-size: 12px; font-style: italic;">${discount.reason}</td>
            </tr>` : ''}` : ''}
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount Paid</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #059669; font-size: 18px;">${amountFormatted}</td>
            </tr>${isPartial && balanceRemainingFormatted ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Remaining Balance</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">${balanceRemainingFormatted}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Payment Method</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #1f2937;">${displayMethod}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Date</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #1f2937;">${paidDate}</td>
            </tr>
          </table>
        </div>

      </div>

      <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
        <p style="margin: 0;">Sent by ${companyName} via EcoLogic</p>
      </div>
    </body>
    </html>
  `;

  const subject = `Receipt: ${invoiceNumber} (${isPartial ? 'Partial' : 'Paid'})`;

  try {
    const emailPayload: any = {
      from: resolvedFrom,
      reply_to: 'no-reply@ecologicc.com',
      to: [to],
      subject,
      html,
    };

    if (pdfAttachment) {
      emailPayload.attachments = [{
        filename: pdfAttachment.filename,
        content: pdfAttachment.content,
      }];
    }

    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error('[ReceiptEmail] Resend API error:', error);
      throw new Error(error.message || 'Failed to send receipt email');
    }

    console.log('[ReceiptEmail] sent', { to, invoiceNumber, id: data?.id, hasPdf: !!pdfAttachment, subject });
    return data?.id || null;
  } catch (err: any) {
    console.error('[ReceiptEmail] failed:', err?.message || err);
    throw err;
  }
}

interface SupportEmailParams {
  type: 'contact_support' | 'bug_report' | 'feature_request';
  subject: string;
  body: string;
  urgency?: string | null;
  stepsToReproduce?: string | null;
  whyUseful?: string | null;
  metadata?: Record<string, any> | null;
  userEmail: string;
  userName: string;
}

export async function sendSupportEmail(params: SupportEmailParams): Promise<string | null> {
  const inboxEmail = process.env.SUPPORT_INBOX_EMAIL;

  const typeLabels: Record<string, string> = {
    contact_support: 'Support',
    bug_report: 'Bug',
    feature_request: 'Feature',
  };

  let emailSubject = '';
  if (params.type === 'contact_support') {
    emailSubject = `[EcoLogic Support] Contact: ${params.subject}`;
  } else if (params.type === 'bug_report') {
    emailSubject = `[EcoLogic Bug] ${(params.urgency || 'Medium').toUpperCase()} - ${params.subject}`;
  } else {
    emailSubject = `[EcoLogic Feature] ${params.subject}`;
  }

  const meta = params.metadata || {};
  const metaLines = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const sections = [
    `Type: ${typeLabels[params.type] || params.type}`,
    `From: ${params.userName} (${params.userEmail})`,
    params.urgency ? `Urgency: ${params.urgency}` : null,
    `\n--- Message ---\n${params.body}`,
    params.stepsToReproduce ? `\n--- Steps to Reproduce ---\n${params.stepsToReproduce}` : null,
    params.whyUseful ? `\n--- Why Useful ---\n${params.whyUseful}` : null,
    metaLines ? `\n--- Context ---\n${metaLines}` : null,
  ].filter(Boolean).join('\n');

  if (!inboxEmail) {
    console.log(`[SupportEmail] SUPPORT_INBOX_EMAIL not set — logging instead`);
    console.log(`[SupportEmail] Subject: ${emailSubject}`);
    console.log(`[SupportEmail] Body:\n${sections}`);
    return null;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.log('[SupportEmail] RESEND_API_KEY not set — logging instead');
    console.log(`[SupportEmail] Subject: ${emailSubject}`);
    console.log(`[SupportEmail] Body:\n${sections}`);
    return null;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: getResendFrom(),
      to: inboxEmail,
      replyTo: params.userEmail,
      subject: emailSubject,
      text: sections,
    });

    if (error) {
      console.error('[SupportEmail] Resend error:', error);
      return null;
    }

    console.log('[SupportEmail] sent', { to: inboxEmail, subject: emailSubject, id: data?.id });
    return data?.id || null;
  } catch (err: any) {
    console.error('[SupportEmail] failed:', err?.message || err);
    return null;
  }
}

// ── Admin-initiated email change verification email ────────────────────────

export async function sendEmailChangeVerificationEmail(
  newEmail: string,
  token: string,
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('[email-change] RESEND_API_KEY not configured — cannot send email change verification');
    throw new Error('Email service not configured');
  }

  const baseUrl = process.env.APP_PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://app.ecologicc.com';
  const verifyUrl = `${baseUrl}/api/auth/verify-email-change?token=${token}`;

  const resendClient = new Resend(resendApiKey);
  const from = getResendFrom();

  console.log('[email-change] Sending verification email — to:', newEmail);

  const { data, error } = await resendClient.emails.send({
    from,
    reply_to: 'no-reply@ecologicc.com',
    to: newEmail,
    subject: 'Confirm your new email address — EcoLogic',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: #1f2937;">Confirm your new email</h2>
        <p style="margin: 0 0 16px; color: #666; font-size: 16px;">
          An admin has requested that your EcoLogic account email be changed to this address.
        </p>
        <p style="margin: 0 0 24px; color: #666; font-size: 16px;">
          Click the button below to confirm the change. If you did not expect this, you can safely ignore this email.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #059669 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Confirm new email
          </a>
        </div>
        <p style="margin: 0 0 16px; color: #666; font-size: 14px;">Or copy and paste this link:</p>
        <p style="margin: 0 0 24px; word-break: break-all; font-size: 12px; color: #999;">${verifyUrl}</p>
        <p style="margin: 0; color: #999; font-size: 14px;">
          This link expires in 24 hours. After confirming, you can sign in with your new email address.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error('[email-change] Resend API error:', JSON.stringify(error));
    throw new Error('Failed to send email change verification');
  }

  console.log('[email-change] Verification email sent — messageId:', data?.id, 'to:', newEmail);
}
