export type QuickReply = {
  key: string;
  label: string;
  body: (vars?: { name?: string }) => string;
};

function applyVars(template: string, vars?: { name?: string }) {
  const name = (vars?.name || "").trim();
  return template.replace(/\{\{\s*name\s*\}\}/g, name || "there");
}

export const QUICK_REPLIES: QuickReply[] = [
  {
    key: "still-available",
    label: "Still available?",
    body: (vars) =>
      applyVars(
        "Hi {{name}}! Yes, it is still available. When would you like to see it?",
        vars
      ),
  },
  {
    key: "schedule-tour",
    label: "Schedule a tour",
    body: (vars) =>
      applyVars(
        "Hi {{name}}! Happy to help. What day and time works best for a quick tour?",
        vars
      ),
  },
  {
    key: "send-details",
    label: "Send details",
    body: (vars) =>
      applyVars(
        "Hi {{name}}! I can send details now. Are you looking for a specific move-in date and price range?",
        vars
      ),
  },
  {
    key: "follow-up",
    label: "Follow up",
    body: (vars) =>
      applyVars(
        "Hi {{name}}! Following up to see if you still want to take a look. I have a couple of times open this week.",
        vars
      ),
  },
];

function encode(str: string) {
  return encodeURIComponent(str);
}

function safe(str?: string) {
  return (str || "").trim();
}

export function buildMailtoLink(
  to: string,
  subject?: string,
  body?: string
) {
  const _to = safe(to);
  const _subject = safe(subject);
  const _body = safe(body);

  const params: string[] = [];
  if (_subject) params.push(`subject=${encode(_subject)}`);
  if (_body) params.push(`body=${encode(_body)}`);

  return `mailto:${_to}${params.length ? `?${params.join("&")}` : ""}`;
}

export function buildSmsLink(to: string, body?: string) {
  const _to = safe(to);
  const _body = safe(body);

  return `sms:${_to}${_body ? `?body=${encode(_body)}` : ""}`;
}
