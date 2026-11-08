// Shared by execution and health reporting: an intentional pause must not
// look like scheduler death, and must never change which jobs may execute.
export const AUTOMATION_TASK_PREFIXES = [
  'appointment.', 'calendar.', 'integration.webhook_',
  'tenant.provision', 'testing.start', 'twilio.a2p_',
] as const;

export function isAutomationTaskType(taskType: string): boolean {
  return AUTOMATION_TASK_PREFIXES.some(prefix => taskType.startsWith(prefix));
}
