// api/src/lib/email.ts
// Email notifications via Resend (https://resend.com)
// npm install resend
// Set RESEND_API_KEY in .env
// Set EMAIL_FROM in .env e.g. "PropManager <noreply@propmanager.co.ke>"

import { logger } from './logger';

const FROM = process.env.EMAIL_FROM ?? 'PropManager <noreply@propmanager.co.ke>';

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn({ to, subject }, 'Email skipped — RESEND_API_KEY not configured');
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ to, subject, err }, 'Email send failed');
      return false;
    }

    logger.info({ to, subject }, 'Email sent');
    return true;
  } catch (e) {
    logger.error({ e, to }, 'Email send error');
    return false;
  }
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f0fafa;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fafa;padding:40px 20px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)">
      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#0d9f9f,#076666);padding:28px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-family:Sora,Arial,sans-serif;font-size:20px;font-weight:800;color:white;letter-spacing:-.5px">PropManager</td>
            <td align="right" style="font-size:11px;color:rgba(255,255,255,.7)">Property Management for Kenya</td>
          </tr>
        </table>
      </td></tr>
      <!-- Content -->
      <tr><td style="padding:32px">${content}</td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0">
        <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
          PropManager · Property Management for Kenya<br>
          <a href="https://propmanager.co.ke" style="color:#0d9f9f;text-decoration:none">propmanager.co.ke</a> · 
          <a href="mailto:support@propmanager.co.ke" style="color:#0d9f9f;text-decoration:none">support@propmanager.co.ke</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function btn(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#0d9f9f,#076666);color:white;text-decoration:none;border-radius:10px;font-family:Sora,Arial,sans-serif;font-weight:700;font-size:15px;margin:20px 0">${text}</a>`;
}

function h1(text: string): string {
  return `<h1 style="font-family:Sora,Arial,sans-serif;font-size:24px;font-weight:800;color:#0a1628;margin:0 0 8px;letter-spacing:-.5px">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="font-size:15px;color:#64748b;line-height:1.7;margin:0 0 16px">${text}</p>`;
}

// ─── WELCOME EMAIL ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  to: string;
  ownerName: string;
  companyName: string;
  trialDays: number;
  loginUrl?: string;
}): Promise<void> {
  const url = opts.loginUrl ?? 'https://app.propmanager.co.ke/login';
  const html = baseTemplate(`
    ${h1(`Welcome to PropManager, ${opts.ownerName.split(' ')[0]}! 🎉`)}
    ${p(`Your account for <strong>${opts.companyName}</strong> is ready. You have a <strong>${opts.trialDays}-day free trial</strong> with full access to all Growth plan features — no credit card needed.`)}
    ${p('Here\'s what you can do right now:')}
    <ul style="color:#64748b;font-size:15px;line-height:2;padding-left:20px;margin:0 0 20px">
      <li>Add your properties and units</li>
      <li>Create tenant leases with automatic proration</li>
      <li>Generate monthly bills and track payments</li>
      <li>Set up M-Pesa PayBill for automatic reconciliation</li>
      <li>Invite your team — managers, accountants, caretakers</li>
    </ul>
    ${btn('Open PropManager →', url)}
    ${p('Need help? Reply to this email or WhatsApp us — we\'re here to make sure you get set up successfully.')}
  `);
  await sendEmail(opts.to, `Welcome to PropManager — Your ${opts.trialDays}-day trial has started`, html);
}

// ─── TRIAL EXPIRY WARNING ─────────────────────────────────────────────────────

export async function sendTrialExpiryEmail(opts: {
  to: string;
  ownerName: string;
  companyName: string;
  daysLeft: number;
  subscribeUrl?: string;
}): Promise<void> {
  const url = opts.subscribeUrl ?? 'https://app.propmanager.co.ke/settings?tab=subscription';
  const urgency = opts.daysLeft === 1 ? '🚨 Last chance —' : opts.daysLeft <= 3 ? '⚠️' : '📅';
  const html = baseTemplate(`
    ${h1(`${urgency} Your trial expires in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}`)}
    ${p(`Hi ${opts.ownerName.split(' ')[0]}, your PropManager free trial for <strong>${opts.companyName}</strong> expires ${opts.daysLeft === 1 ? 'tomorrow' : `in ${opts.daysLeft} days`}.`)}
    ${p('After your trial ends, you\'ll lose access to:')}
    <ul style="color:#64748b;font-size:15px;line-height:2;padding-left:20px;margin:0 0 20px">
      <li>Your tenant and billing data</li>
      <li>Automated rent reminders</li>
      <li>Financial reports and exports</li>
      <li>M-Pesa payment reconciliation</li>
    </ul>
    ${p('<strong>Subscribe now from KES 2,500/month</strong> to keep full access to all your data and continue managing your properties without interruption.')}
    ${btn('Subscribe Now →', url)}
    ${p('Questions? WhatsApp us at +254 700 000 000 — we\'ll help you choose the right plan.')}
  `);
  await sendEmail(opts.to, `Your PropManager trial expires in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}`, html);
}

// ─── SUBSCRIPTION ACTIVATION ──────────────────────────────────────────────────

export async function sendSubscriptionActivatedEmail(opts: {
  to: string;
  ownerName: string;
  companyName: string;
  plan: string;
  amount: number;
  nextBillingDate: string;
}): Promise<void> {
  const planName = opts.plan.charAt(0).toUpperCase() + opts.plan.slice(1);
  const html = baseTemplate(`
    ${h1(`✅ Subscription activated — ${planName} plan`)}
    ${p(`Hi ${opts.ownerName.split(' ')[0]}, your payment was received and your <strong>${planName} plan</strong> for <strong>${opts.companyName}</strong> is now active.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fafa;border-radius:10px;padding:16px 20px;margin:0 0 20px">
      <tr><td style="font-size:13px;color:#64748b;padding:6px 0">Plan</td><td align="right" style="font-weight:700;color:#0a1628;font-size:13px">${planName}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:6px 0">Amount paid</td><td align="right" style="font-weight:700;color:#0a1628;font-size:13px">KES ${opts.amount.toLocaleString()}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:6px 0">Next billing date</td><td align="right" style="font-weight:700;color:#0a1628;font-size:13px">${opts.nextBillingDate}</td></tr>
    </table>
    ${p('Thank you for choosing PropManager. Your subscription renews automatically each month via M-Pesa.')}
    ${btn('Open Dashboard →', 'https://app.propmanager.co.ke/dashboard')}
  `);
  await sendEmail(opts.to, `✅ PropManager ${planName} plan activated`, html);
}

// ─── TENANT PORTAL INVITATION ─────────────────────────────────────────────────

export async function sendTenantInviteEmail(opts: {
  to: string;
  tenantName: string;
  companyName: string;
  unitNumber: string;
  tempPassword: string;
  portalUrl?: string;
}): Promise<void> {
  const url = opts.portalUrl ?? 'https://app.propmanager.co.ke/portal';
  const html = baseTemplate(`
    ${h1(`You've been invited to the tenant portal`)}
    ${p(`Hi ${opts.tenantName.split(' ')[0]}, <strong>${opts.companyName}</strong> has set up your tenant account on PropManager.`)}
    ${p('Through the tenant portal you can:')}
    <ul style="color:#64748b;font-size:15px;line-height:2;padding-left:20px;margin:0 0 20px">
      <li>View your bills and payment history</li>
      <li>Download receipts</li>
      <li>Submit maintenance requests</li>
      <li>See your lease details</li>
    </ul>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fafa;border-radius:10px;padding:16px 20px;margin:0 0 20px">
      <tr><td style="font-size:13px;color:#64748b;padding:6px 0">Unit</td><td align="right" style="font-weight:700;color:#0a1628;font-size:13px">${opts.unitNumber}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:6px 0">Your email</td><td align="right" style="font-weight:700;color:#0a1628;font-size:13px">${opts.to}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:6px 0">Temporary password</td><td align="right" style="font-weight:700;color:#0d9f9f;font-size:13px;letter-spacing:1px">${opts.tempPassword}</td></tr>
    </table>
    ${p('Please log in and change your password immediately after your first sign-in.')}
    ${btn('Access Tenant Portal →', url)}
  `);
  await sendEmail(opts.to, `Your tenant portal access for ${opts.companyName}`, html);
}
