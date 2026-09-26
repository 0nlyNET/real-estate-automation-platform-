import { NotificationCategory, NotificationSeverity } from './notification.entity';

/**
 * Operational email template registry for RealtyTechAI.
 *
 * Every template answers: what happened / who is affected / what was
 * automatically done / what action is needed / what happens if ignored /
 * where to click. Client-facing templates use customer language — no stack
 * traces, no raw provider errors.
 *
 * Action URLs are always absolute, built from the canonical frontend URL plus
 * an internal path (must start with /admin or /app). Never put raw relative
 * paths in an email.
 */

export type TemplateContext = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface NotificationTemplate {
  id: string;
  defaultSeverity: NotificationSeverity;
  defaultCategory: NotificationCategory;
  subject: (ctx: TemplateContext) => string;
  htmlBody: (ctx: TemplateContext) => string;
  textBody: (ctx: TemplateContext) => string;
}

const FRONTEND_FALLBACK = 'https://www.realtytechai.app';

export function frontendBaseUrl(): string {
  return String(process.env.FRONTEND_URL || FRONTEND_FALLBACK).replace(/\/+$/, '');
}

/** Build a canonical absolute action URL from an internal path. */
export function canonicalActionUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (
    (!path.startsWith('/admin') && !path.startsWith('/app')) ||
    path.startsWith('//') ||
    path.includes('://')
  ) {
    throw new Error('Notification action must be an internal RealtyTechAI URL');
  }
  return `${frontendBaseUrl()}${path}`;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function button(url: string, label: string): string {
  return (
    `<p style="margin: 20px 0;">` +
    `<a href="${esc(url)}" style="display:inline-block;padding:12px 20px;background:#111827;` +
    `color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">` +
    `${esc(label)}</a></p>`
  );
}

function layout(title: string, bodyHtml: string): string {
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;color:#111827;">` +
    `<div style="background:#111827;color:#ffffff;padding:16px 20px;border-radius:12px 12px 0 0;">` +
    `<div style="font-size:18px;font-weight:700;">RealtyTechAI</div>` +
    `<div style="font-size:12px;color:#9ca3af;">Operational notification</div>` +
    `</div>` +
    `<div style="background:#ffffff;padding:24px 20px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">` +
    `<h1 style="margin:0 0 16px 0;font-size:20px;">${esc(title)}</h1>` +
    bodyHtml +
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px 0;" />` +
    `<p style="margin:0;font-size:12px;color:#6b7280;">This is an automated operational message from RealtyTechAI. ` +
    `Replying to this email will not reach support.</p>` +
    `</div></div></body></html>`
  );
}

function kv(label: string, value: unknown): string {
  return (
    `<p style="margin:0 0 8px 0;font-size:14px;">` +
    `<strong>${esc(label)}:</strong> ${esc(value)}</p>`
  );
}

const str = (ctx: TemplateContext, key: string, fallback = ''): string =>
  ctx[key] === null || ctx[key] === undefined ? fallback : String(ctx[key]);

const templates: NotificationTemplate[] = [
  {
    id: 'platform.critical_incident',
    defaultSeverity: 'critical',
    defaultCategory: 'system',
    subject: (ctx) => `CRITICAL: ${str(ctx, 'incidentTitle', 'Platform incident')}`,
    htmlBody: (ctx) =>
      layout(
        `Critical incident: ${str(ctx, 'incidentTitle', 'Platform incident')}`,
        kv('What happened', str(ctx, 'whatHappened')) +
          kv('Affected', str(ctx, 'affected')) +
          kv('Automatic action', str(ctx, 'autoAction', 'None — manual action required.')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'actionNeeded'))}</p>` +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, str(ctx, 'actionLabel', 'Investigate'))
            : '') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: ${esc(str(ctx, 'ifIgnored', 'the incident may continue to affect clients.'))}</p>`,
      ),
    textBody: (ctx) =>
      `CRITICAL — ${str(ctx, 'incidentTitle', 'Platform incident')}\n\n` +
      `What happened: ${str(ctx, 'whatHappened')}\n` +
      `Affected: ${str(ctx, 'affected')}\n` +
      `Automatic action: ${str(ctx, 'autoAction', 'None — manual action required.')}\n` +
      `Action needed: ${str(ctx, 'actionNeeded')}\n` +
      (str(ctx, 'actionPath') ? `Investigate: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : '') +
      `If ignored: ${str(ctx, 'ifIgnored', 'the incident may continue to affect clients.')}\n`,
  },
  {
    id: 'platform.warning',
    defaultSeverity: 'warning',
    defaultCategory: 'system',
    subject: (ctx) => `Warning: ${str(ctx, 'warningTitle', 'Platform warning')}`,
    htmlBody: (ctx) =>
      layout(
        `Warning: ${str(ctx, 'warningTitle', 'Platform warning')}`,
        kv('What happened', str(ctx, 'whatHappened')) +
          kv('Affected', str(ctx, 'affected')) +
          kv('Automatic action', str(ctx, 'autoAction', 'Logged for review.')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'actionNeeded'))}</p>` +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, str(ctx, 'actionLabel', 'Review'))
            : ''),
      ),
    textBody: (ctx) =>
      `Warning — ${str(ctx, 'warningTitle', 'Platform warning')}\n\n` +
      `What happened: ${str(ctx, 'whatHappened')}\n` +
      `Affected: ${str(ctx, 'affected')}\n` +
      `Automatic action: ${str(ctx, 'autoAction', 'Logged for review.')}\n` +
      `Action needed: ${str(ctx, 'actionNeeded')}\n` +
      (str(ctx, 'actionPath') ? `Review: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'integration.disconnected',
    defaultSeverity: 'warning',
    defaultCategory: 'integrations',
    subject: (ctx) =>
      str(ctx, 'tenantName')
        ? `${str(ctx, 'provider')} disconnected for ${str(ctx, 'tenantName')}`
        : `${str(ctx, 'provider')} connection failing`,
    htmlBody: (ctx) => {
      const tenantScoped = Boolean(str(ctx, 'tenantName'));
      return layout(
        `${str(ctx, 'provider')} connection problem`,
        (tenantScoped ? kv('Workspace', str(ctx, 'tenantName')) : kv('Scope', 'Platform-wide')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'explanation', `RealtyTechAI can no longer reach ${str(ctx, 'provider')}. Automated work that depends on it has been paused to keep your data safe — nothing will send or sync until the connection is restored.`))}</p>` +
          kv('What we did automatically', 'Paused dependent automations. Your existing data is untouched.') +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, str(ctx, 'actionLabel', `Reconnect ${str(ctx, 'provider')}`))
            : '') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: automations that need ${esc(str(ctx, 'provider'))} stay paused and leads may wait for manual handling.</p>`,
      );
    },
    textBody: (ctx) =>
      `${str(ctx, 'provider')} connection problem\n\n` +
      (str(ctx, 'tenantName') ? `Workspace: ${str(ctx, 'tenantName')}\n` : `Scope: platform-wide\n`) +
      `${str(ctx, 'explanation', `RealtyTechAI can no longer reach ${str(ctx, 'provider')}. Automated work that depends on it has been paused to keep your data safe.`)}\n\n` +
      `What we did automatically: paused dependent automations. Your existing data is untouched.\n` +
      (str(ctx, 'actionPath') ? `Reconnect: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : '') +
      `If ignored: automations that need ${str(ctx, 'provider')} stay paused.\n`,
  },
  {
    id: 'integration.recovered',
    defaultSeverity: 'success',
    defaultCategory: 'integrations',
    subject: (ctx) => `${str(ctx, 'provider')} recovered`,
    htmlBody: (ctx) =>
      layout(
        `${str(ctx, 'provider')} is working again`,
        `<p style="font-size:14px;">${esc(str(ctx, 'provider'))} recovered after ${esc(str(ctx, 'downtimeMinutes', '?'))} minutes. ` +
          `Delivery and sync are operating normally again.</p>` +
          kv('What we did automatically', 'Resumed the automations that were paused during the outage.') +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, 'View status')
            : ''),
      ),
    textBody: (ctx) =>
      `${str(ctx, 'provider')} recovered after ${str(ctx, 'downtimeMinutes', '?')} minutes. Delivery and sync are operating normally again.\n\n` +
      `What we did automatically: resumed the automations that were paused during the outage.\n` +
      (str(ctx, 'actionPath') ? `View status: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'client.ready_for_activation',
    defaultSeverity: 'success',
    defaultCategory: 'onboarding',
    subject: (ctx) => `${str(ctx, 'tenantName', 'Client')} is ready for activation`,
    htmlBody: (ctx) => {
      const checks: Array<[string, string]> = [
        ['Billing', str(ctx, 'billing', 'Pending')],
        ['Email', str(ctx, 'email', 'Pending')],
        ['CRM', str(ctx, 'crm', 'Pending')],
        ['Calendar', str(ctx, 'calendar', 'Pending')],
        ['AI test', str(ctx, 'aiTest', 'Pending')],
        ['Backup requirements', str(ctx, 'backup', 'Pending')],
        ['Consent / configuration', str(ctx, 'consent', 'Pending')],
      ];
      const rows = checks
        .map(
          ([label, value]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;">${esc(label)}</td>` +
            `<td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:600;color:${value === 'Passed' ? '#047857' : '#b45309'};">${esc(value)}</td></tr>`,
        )
        .join('');
      return layout(
        `${str(ctx, 'tenantName', 'Client')} — ready for activation`,
        `<p style="font-size:14px;">All launch checks completed for <strong>${esc(str(ctx, 'tenantName'))}</strong>.</p>` +
          `<table style="width:100%;border-collapse:collapse;margin:12px 0;">${rows}</table>` +
          button(canonicalActionUrl(str(ctx, 'actionPath', '/admin/clients'))!, 'Review & activate workspace') +
          `<p style="font-size:13px;color:#6b7280;">Activating starts the client's automations. If ignored, the client stays in testing and no automated outreach runs.</p>`,
      );
    },
    textBody: (ctx) =>
      `${str(ctx, 'tenantName', 'Client')} is READY FOR ACTIVATION\n\n` +
      `Billing: ${str(ctx, 'billing', 'Pending')}\n` +
      `Email: ${str(ctx, 'email', 'Pending')}\n` +
      `CRM: ${str(ctx, 'crm', 'Pending')}\n` +
      `Calendar: ${str(ctx, 'calendar', 'Pending')}\n` +
      `AI test: ${str(ctx, 'aiTest', 'Pending')}\n` +
      `Backup requirements: ${str(ctx, 'backup', 'Pending')}\n` +
      `Consent / configuration: ${str(ctx, 'consent', 'Pending')}\n\n` +
      `Review and activate: ${canonicalActionUrl(str(ctx, 'actionPath', '/admin/clients'))}\n`,
  },
  {
    id: 'client.activation_blocked',
    defaultSeverity: 'warning',
    defaultCategory: 'onboarding',
    subject: (ctx) => `Activation blocked for ${str(ctx, 'tenantName', 'a client')}`,
    htmlBody: (ctx) =>
      layout(
        `Activation blocked: ${str(ctx, 'tenantName', 'Client')}`,
        kv('What is blocking', str(ctx, 'blocker')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'whatIsNeeded', 'Resolve the blocker above, then re-run the launch checks.'))}</p>` +
          kv('What we did automatically', 'Kept the workspace in testing mode. No client-facing automations are running.') +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, 'Open onboarding checklist')
            : '') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: the client cannot go live until the blocker is cleared.</p>`,
      ),
    textBody: (ctx) =>
      `Activation blocked: ${str(ctx, 'tenantName', 'Client')}\n\n` +
      `What is blocking: ${str(ctx, 'blocker')}\n` +
      `What is needed: ${str(ctx, 'whatIsNeeded', 'Resolve the blocker, then re-run the launch checks.')}\n` +
      `Automatic action: workspace kept in testing mode; no client-facing automations running.\n` +
      (str(ctx, 'actionPath') ? `Open checklist: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'backup.failed',
    defaultSeverity: 'warning',
    defaultCategory: 'system',
    subject: (ctx) => `Backup failed: ${str(ctx, 'detail', 'scheduled backup did not complete')}`,
    htmlBody: (ctx) =>
      layout(
        'Backup failed',
        kv('What happened', str(ctx, 'detail', 'A scheduled backup did not complete.')) +
          kv('Automatic action', 'The backup will be retried on the next scheduled run. The previous good backup is still available for restore.') +
          `<p style="font-size:14px;">${esc(str(ctx, 'actionNeeded', 'Check the backup logs. If the next scheduled backup also fails, this escalates to a critical alert.'))}</p>` +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, 'View backup status')
            : '') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: recovery-point age grows and a restore would lose more recent data.</p>`,
      ),
    textBody: (ctx) =>
      `Backup failed\n\n` +
      `What happened: ${str(ctx, 'detail', 'A scheduled backup did not complete.')}\n` +
      `Automatic action: retry on next scheduled run; previous good backup still available.\n` +
      `Action needed: ${str(ctx, 'actionNeeded', 'Check backup logs. A second consecutive failure escalates to critical.')}\n` +
      (str(ctx, 'actionPath') ? `View backup status: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'backup.recovered',
    defaultSeverity: 'success',
    defaultCategory: 'system',
    subject: () => 'Backup pipeline recovered',
    htmlBody: (ctx) =>
      layout(
        'Backup pipeline recovered',
        `<p style="font-size:14px;">The scheduled backup completed successfully${str(ctx, 'downtimeMinutes') ? ` after ${esc(str(ctx, 'downtimeMinutes'))} minutes of failures` : ''}. Recovery-point objectives are being met again.</p>` +
          kv('Automatic action', 'Resumed the normal backup schedule. No manual steps required.') +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, 'View backup status')
            : ''),
      ),
    textBody: (ctx) =>
      `Backup pipeline recovered\n\n` +
      `The scheduled backup completed successfully${str(ctx, 'downtimeMinutes') ? ` after ${str(ctx, 'downtimeMinutes')} minutes of failures` : ''}. RPO targets are being met again.\n` +
      (str(ctx, 'actionPath') ? `View backup status: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'billing.problem',
    defaultSeverity: 'warning',
    defaultCategory: 'billing',
    subject: (ctx) => `Billing issue: ${str(ctx, 'summary', 'action required')}`,
    htmlBody: (ctx) =>
      layout(
        `Billing issue: ${str(ctx, 'summary', 'action required')}`,
        kv('Workspace', str(ctx, 'tenantName', 'Your workspace')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'explanation'))}</p>` +
          kv('What we did automatically', str(ctx, 'autoAction', 'Logged the event and will retry where applicable.')) +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, str(ctx, 'actionLabel', 'View billing'))
            : '') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: ${esc(str(ctx, 'ifIgnored', 'the subscription may be suspended for non-payment.'))}</p>`,
      ),
    textBody: (ctx) =>
      `Billing issue: ${str(ctx, 'summary', 'action required')}\n\n` +
      `Workspace: ${str(ctx, 'tenantName', 'Your workspace')}\n` +
      `${str(ctx, 'explanation')}\n\n` +
      `What we did automatically: ${str(ctx, 'autoAction', 'Logged the event and will retry where applicable.')}\n` +
      (str(ctx, 'actionPath') ? `View billing: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : '') +
      `If ignored: ${str(ctx, 'ifIgnored', 'the subscription may be suspended for non-payment.')}\n`,
  },
  {
    id: 'lead.ai_handoff',
    defaultSeverity: 'warning',
    defaultCategory: 'leads',
    subject: (ctx) => `AI handed off a conversation — ${str(ctx, 'leadName', 'a lead')}`,
    htmlBody: (ctx) =>
      layout(
        `AI needs you to take over: ${str(ctx, 'leadName', 'Lead')}`,
        kv('Lead', str(ctx, 'leadName')) +
          kv('Source', str(ctx, 'leadSource', 'Unknown')) +
          `<p style="font-size:14px;"><strong>Why:</strong> ${esc(str(ctx, 'handoffReason'))}</p>` +
          `<p style="font-size:14px;"><strong>Conversation so far:</strong> ${esc(str(ctx, 'summary'))}</p>` +
          `<p style="font-size:14px;"><strong>AI recommendation:</strong> ${esc(str(ctx, 'aiRecommendation', 'Review the conversation and reply personally.'))}</p>` +
          kv('AI status for this lead', str(ctx, 'aiPaused') === 'true' || ctx.aiPaused === true ? 'Paused — waiting for you' : 'Still assisting') +
          button(canonicalActionUrl(str(ctx, 'actionPath', '/app/conversations'))!, 'Open conversation') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: the lead waits without a reply. You will not get another email for this handoff unless it stays unresolved.</p>`,
      ),
    textBody: (ctx) =>
      `AI handed off a conversation — ${str(ctx, 'leadName', 'a lead')}\n\n` +
      `Lead: ${str(ctx, 'leadName')}\n` +
      `Source: ${str(ctx, 'leadSource', 'Unknown')}\n` +
      `Why: ${str(ctx, 'handoffReason')}\n` +
      `Conversation so far: ${str(ctx, 'summary')}\n` +
      `AI recommendation: ${str(ctx, 'aiRecommendation', 'Review the conversation and reply personally.')}\n` +
      `AI status: ${str(ctx, 'aiPaused') === 'true' || ctx.aiPaused === true ? 'paused — waiting for you' : 'still assisting'}\n\n` +
      `Open conversation: ${canonicalActionUrl(str(ctx, 'actionPath', '/app/conversations'))}\n`,
  },
  {
    id: 'lead.hot_lead',
    defaultSeverity: 'warning',
    defaultCategory: 'leads',
    subject: (ctx) => `Hot lead needs your attention — ${str(ctx, 'leadName', 'new lead')}`,
    htmlBody: (ctx) =>
      layout(
        `Hot lead: ${str(ctx, 'leadName', 'New lead')}`,
        kv('Lead', str(ctx, 'leadName')) +
          kv('Source', str(ctx, 'leadSource', 'Unknown')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'whyHot', 'This lead showed high intent and should be contacted promptly.'))}</p>` +
          `<p style="font-size:14px;"><strong>Recommended next step:</strong> ${esc(str(ctx, 'nextStep', 'Call or message within the hour.'))}</p>` +
          button(canonicalActionUrl(str(ctx, 'actionPath', '/app/conversations'))!, 'Open conversation'),
      ),
    textBody: (ctx) =>
      `Hot lead needs your attention — ${str(ctx, 'leadName', 'new lead')}\n\n` +
      `Lead: ${str(ctx, 'leadName')}\n` +
      `Source: ${str(ctx, 'leadSource', 'Unknown')}\n` +
      `${str(ctx, 'whyHot', 'This lead showed high intent and should be contacted promptly.')}\n` +
      `Recommended next step: ${str(ctx, 'nextStep', 'Call or message within the hour.')}\n\n` +
      `Open conversation: ${canonicalActionUrl(str(ctx, 'actionPath', '/app/conversations'))}\n`,
  },
  {
    id: 'appointment.booked',
    defaultSeverity: 'success',
    defaultCategory: 'tasks',
    subject: (ctx) => `New appointment booked — ${str(ctx, 'leadName', 'a lead')}`,
    htmlBody: (ctx) =>
      layout(
        'New appointment booked from RealtyTechAI',
        kv('Lead', str(ctx, 'leadName')) +
          kv('When', str(ctx, 'when')) +
          kv('Source', str(ctx, 'leadSource', 'Unknown')) +
          kv('Qualification', str(ctx, 'qualification', 'Not yet qualified')) +
          `<p style="font-size:13px;color:#6b7280;">Your connected calendar already sent the normal event invitation — this is just the RealtyTechAI context.</p>` +
          button(canonicalActionUrl(str(ctx, 'actionPath', '/app/conversations'))!, 'Open lead'),
      ),
    textBody: (ctx) =>
      `New appointment booked from RealtyTechAI\n\n` +
      `Lead: ${str(ctx, 'leadName')}\n` +
      `When: ${str(ctx, 'when')}\n` +
      `Source: ${str(ctx, 'leadSource', 'Unknown')}\n` +
      `Qualification: ${str(ctx, 'qualification', 'Not yet qualified')}\n\n` +
      `Your connected calendar already sent the normal event invitation.\n` +
      `Open lead: ${canonicalActionUrl(str(ctx, 'actionPath', '/app/conversations'))}\n`,
  },
  {
    id: 'appointment.changed',
    defaultSeverity: 'warning',
    defaultCategory: 'tasks',
    subject: (ctx) => `Appointment ${str(ctx, 'changeType', 'updated')} — ${str(ctx, 'leadName', 'a lead')}`,
    htmlBody: (ctx) =>
      layout(
        `Appointment ${str(ctx, 'changeType', 'updated')}`,
        kv('Lead', str(ctx, 'leadName')) +
          kv('Change', str(ctx, 'changeType', 'updated')) +
          kv('Details', str(ctx, 'details', '')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'actionNeeded', 'Review the appointment and follow up with the lead if needed.'))}</p>` +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, 'Open appointment')
            : ''),
      ),
    textBody: (ctx) =>
      `Appointment ${str(ctx, 'changeType', 'updated')} — ${str(ctx, 'leadName', 'a lead')}\n\n` +
      `Details: ${str(ctx, 'details', '')}\n` +
      `Action: ${str(ctx, 'actionNeeded', 'Review the appointment and follow up with the lead if needed.')}\n` +
      (str(ctx, 'actionPath') ? `Open appointment: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'automation.paused',
    defaultSeverity: 'warning',
    defaultCategory: 'system',
    subject: (ctx) =>
      str(ctx, 'tenantName')
        ? `Automation paused for ${str(ctx, 'tenantName')}`
        : 'Automation paused',
    htmlBody: (ctx) =>
      layout(
        `Automation paused${str(ctx, 'tenantName') ? ` — ${str(ctx, 'tenantName')}` : ''}`,
        kv('Why', str(ctx, 'reason')) +
          kv('Are leads/messages safe', str(ctx, 'safetyNote', 'Yes. No automated messages will send until this is resolved. Existing conversations are preserved.')) +
          `<p style="font-size:14px;">${esc(str(ctx, 'actionNeeded', 'Review the reason below and resume when ready.'))}</p>` +
          (str(ctx, 'actionPath')
            ? button(canonicalActionUrl(str(ctx, 'actionPath'))!, str(ctx, 'actionLabel', 'Review automation'))
            : '') +
          `<p style="font-size:13px;color:#6b7280;">If ignored: automations stay paused and leads wait for manual handling.</p>`,
      ),
    textBody: (ctx) =>
      `Automation paused${str(ctx, 'tenantName') ? ` — ${str(ctx, 'tenantName')}` : ''}\n\n` +
      `Why: ${str(ctx, 'reason')}\n` +
      `Are leads/messages safe: ${str(ctx, 'safetyNote', 'Yes. No automated messages will send until resolved.')}\n` +
      `Action: ${str(ctx, 'actionNeeded', 'Review the reason and resume when ready.')}\n` +
      (str(ctx, 'actionPath') ? `Review: ${canonicalActionUrl(str(ctx, 'actionPath'))}\n` : ''),
  },
  {
    id: 'digest.daily_client',
    defaultSeverity: 'info',
    defaultCategory: 'clients',
    subject: (ctx) => `RealtyTechAI daily summary — ${str(ctx, 'date', 'today')}`,
    htmlBody: (ctx) => {
      const items = String(str(ctx, 'actionItems', '')).split('\n').filter(Boolean);
      return layout(
        `Daily summary — ${str(ctx, 'tenantName', 'your workspace')}`,
        `<table style="width:100%;border-collapse:collapse;margin:12px 0;">` +
          [
            ['New leads', str(ctx, 'newLeads', '0')],
            ['AI conversations', str(ctx, 'aiConversations', '0')],
            ['Human handoffs', str(ctx, 'humanHandoffs', '0')],
            ['Qualified leads', str(ctx, 'qualifiedLeads', '0')],
            ['Appointments booked', str(ctx, 'appointmentsBooked', '0')],
            ['Leads needing attention', str(ctx, 'leadsNeedingAttention', '0')],
          ]
            .map(
              ([label, value]) =>
                `<tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;">${esc(label)}</td>` +
                `<td style="padding:6px 0;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:600;text-align:right;">${esc(value)}</td></tr>`,
            )
            .join('') +
          `</table>` +
          kv('Integration health', str(ctx, 'integrationHealth', 'All systems operational')) +
          (items.length
            ? `<p style="font-size:14px;"><strong>Top items needing action:</strong></p><ul style="font-size:14px;">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
            : `<p style="font-size:14px;color:#047857;">Nothing needs your attention right now.</p>`) +
          button(canonicalActionUrl(str(ctx, 'actionPath', '/app/dashboard'))!, 'View dashboard'),
      );
    },
    textBody: (ctx) =>
      `RealtyTechAI Daily Summary — ${str(ctx, 'tenantName', 'your workspace')}\n\n` +
      `New leads: ${str(ctx, 'newLeads', '0')}\n` +
      `AI conversations: ${str(ctx, 'aiConversations', '0')}\n` +
      `Human handoffs: ${str(ctx, 'humanHandoffs', '0')}\n` +
      `Qualified leads: ${str(ctx, 'qualifiedLeads', '0')}\n` +
      `Appointments booked: ${str(ctx, 'appointmentsBooked', '0')}\n` +
      `Leads needing attention: ${str(ctx, 'leadsNeedingAttention', '0')}\n\n` +
      `Integration health: ${str(ctx, 'integrationHealth', 'All systems operational')}\n\n` +
      (str(ctx, 'actionItems') ? `Top items needing action:\n${str(ctx, 'actionItems')}\n\n` : 'Nothing needs your attention right now.\n\n') +
      `View dashboard: ${canonicalActionUrl(str(ctx, 'actionPath', '/app/dashboard'))}\n`,
  },
  {
    id: 'digest.daily_admin',
    defaultSeverity: 'info',
    defaultCategory: 'system',
    subject: (ctx) => `RealtyTechAI ops digest — ${str(ctx, 'date', 'today')}`,
    htmlBody: (ctx) =>
      layout(
        'Daily operations digest',
        `<p style="font-size:14px;"><strong>Clients</strong> — active: ${esc(str(ctx, 'clientsActive', '0'))}, ` +
          `onboarding: ${esc(str(ctx, 'clientsOnboarding', '0'))}, testing: ${esc(str(ctx, 'clientsTesting', '0'))}, ` +
          `paused/suspended: ${esc(str(ctx, 'clientsPaused', '0'))}</p>` +
          `<p style="font-size:14px;"><strong>Revenue</strong> — new customers: ${esc(str(ctx, 'newCustomers', '0'))}, ` +
          `setup payments: ${esc(str(ctx, 'setupPayments', '0'))}, failed payments: ${esc(str(ctx, 'failedPayments', '0'))}</p>` +
          `<p style="font-size:14px;"><strong>Operations</strong> — provider failures: ${esc(str(ctx, 'providerFailures', '0'))}, ` +
          `unresolved incidents: ${esc(str(ctx, 'unresolvedIncidents', '0'))}, automation pauses: ${esc(str(ctx, 'automationPauses', '0'))}, ` +
          `backup: ${esc(str(ctx, 'backupStatus', 'ok'))}</p>` +
          `<p style="font-size:14px;"><strong>Onboarding</strong> — ready for activation: ${esc(str(ctx, 'readyForActivation', '0'))}, ` +
          `blocked: ${esc(str(ctx, 'blockedOnboarding', '0'))}</p>` +
          (str(ctx, 'topIssues')
            ? `<p style="font-size:14px;"><strong>Needs attention:</strong></p><ul style="font-size:14px;">${String(str(ctx, 'topIssues')).split('\n').filter(Boolean).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
            : `<p style="font-size:14px;color:#047857;">No open issues. Platform nominal.</p>`) +
          button(canonicalActionUrl(str(ctx, 'actionPath', '/admin/dashboard'))!, 'Open admin dashboard'),
      ),
    textBody: (ctx) =>
      `RealtyTechAI Daily Operations Digest\n\n` +
      `Clients — active: ${str(ctx, 'clientsActive', '0')}, onboarding: ${str(ctx, 'clientsOnboarding', '0')}, testing: ${str(ctx, 'clientsTesting', '0')}, paused/suspended: ${str(ctx, 'clientsPaused', '0')}\n` +
      `Revenue — new customers: ${str(ctx, 'newCustomers', '0')}, setup payments: ${str(ctx, 'setupPayments', '0')}, failed payments: ${str(ctx, 'failedPayments', '0')}\n` +
      `Operations — provider failures: ${str(ctx, 'providerFailures', '0')}, unresolved incidents: ${str(ctx, 'unresolvedIncidents', '0')}, automation pauses: ${str(ctx, 'automationPauses', '0')}, backup: ${str(ctx, 'backupStatus', 'ok')}\n` +
      `Onboarding — ready for activation: ${str(ctx, 'readyForActivation', '0')}, blocked: ${str(ctx, 'blockedOnboarding', '0')}\n\n` +
      (str(ctx, 'topIssues') ? `Needs attention:\n${str(ctx, 'topIssues')}\n\n` : 'No open issues. Platform nominal.\n\n') +
      `Open admin dashboard: ${canonicalActionUrl(str(ctx, 'actionPath', '/admin/dashboard'))}\n`,
  },
];

const registry = new Map<string, NotificationTemplate>();
for (const template of templates) registry.set(template.id, template);

export function getTemplate(id: string): NotificationTemplate | undefined {
  return registry.get(id);
}

export function listTemplateIds(): string[] {
  return [...registry.keys()];
}
