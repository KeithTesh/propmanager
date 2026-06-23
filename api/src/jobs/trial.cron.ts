// api/src/jobs/trial.cron.ts
// Sends SMS reminders as trial approaches expiry
// Fires daily at 09:00 Nairobi time
// Add to your cron scheduler (node-cron or similar)

import { sql } from '../db';
import { logger } from '../lib/logger';
import { sendSms } from '../lib/sms';
import { sendTrialExpiryEmail } from '../lib/email';

export async function runTrialReminderCron() {
  logger.info('Running trial reminder cron');

  // Find trialing companies whose trial expires in 7, 3, or 1 day(s)
  // that haven't received that specific reminder yet
  const companies = await sql`
    SELECT
      c.id, c.name, c.phone, c.email, c.trial_ends_at,
      c.owner_notify_sms, c.owner_notify_email,
      u.full_name AS owner_name, u.phone AS owner_phone,
      CEIL(EXTRACT(EPOCH FROM (c.trial_ends_at - NOW())) / 86400)::int AS days_left
    FROM companies c
    JOIN users u ON u.company_id = c.id AND u.role = 'owner' AND u.deleted_at IS NULL
    WHERE c.subscription_status = 'trialing'
      AND c.trial_ends_at IS NOT NULL
      AND c.trial_ends_at > NOW()
      AND c.deleted_at IS NULL
      AND CEIL(EXTRACT(EPOCH FROM (c.trial_ends_at - NOW())) / 86400)::int IN (7, 3, 1)
      AND NOT EXISTS (
        SELECT 1 FROM trial_notifications tn
        WHERE tn.company_id = c.id
          AND tn.days_before = CEIL(EXTRACT(EPOCH FROM (c.trial_ends_at - NOW())) / 86400)::int
      )
  `;

  let sent = 0;

  for (const company of companies) {
    const daysLeft  = company.days_left;
    const phone     = company.owner_phone ?? company.phone;
    const firstName = (company.owner_name ?? company.name).split(' ')[0];

    if (!phone) continue;

    let message = '';
    if (daysLeft === 7) {
      message = `Hi ${firstName}, your PropManager free trial has 7 days remaining. ` +
        `Subscribe now from KES 2,500/month to keep full access. ` +
        `Log in at propmanager.co.ke to activate your plan.`;
    } else if (daysLeft === 3) {
      message = `⚠️ ${firstName}, your PropManager trial ends in 3 days. ` +
        `Don't lose access to your data — subscribe now from KES 2,500/month. ` +
        `Visit propmanager.co.ke or WhatsApp us for help.`;
    } else if (daysLeft === 1) {
      message = `🚨 ${firstName}, your PropManager trial expires TOMORROW. ` +
        `Subscribe today to keep managing your properties without interruption. ` +
        `From KES 2,500/month — propmanager.co.ke`;
    }

    try {
      if (company.owner_notify_sms !== false) { await sendSms(phone, message); }
      if (company.owner_notify_email !== false && company.email) { await sendTrialExpiryEmail({ to: company.email, ownerName: company.owner_name ?? company.name, companyName: company.name, daysLeft }).catch(() => {}); }
      // Mark as sent to prevent duplicates
      await sql`
        INSERT INTO trial_notifications (company_id, days_before)
        VALUES (${company.id}, ${daysLeft})
        ON CONFLICT DO NOTHING
      `;
      sent++;
      logger.info({ companyId: company.id, daysLeft }, `Trial reminder sent (${daysLeft}d)`);
    } catch (e) {
      logger.warn({ e, companyId: company.id }, 'Trial reminder SMS failed');
    }
  }

  // Also auto-expire trials that ended without converting
  const expired = await sql`
    UPDATE companies SET
      subscription_status = 'expired',
      updated_at = NOW()
    WHERE subscription_status = 'trialing'
      AND trial_ends_at < NOW()
      AND deleted_at IS NULL
    RETURNING id, name, phone
  `;

  for (const c of expired) {
    if (c.phone) {
      await sendSms(c.phone,
        `Your PropManager free trial has ended. Subscribe from KES 2,500/month ` +
        `to restore full access — propmanager.co.ke or WhatsApp us.`
      ).catch(() => {});
    }
    await sql`
      INSERT INTO subscription_events (company_id, event_type, old_status, new_status, notes)
      VALUES (${c.id}, 'trial_expired', 'trialing', 'expired', 'Auto-expired by cron')
    `.catch(() => {});
  }

  logger.info({ sent, expired: expired.length }, 'Trial cron complete');
}