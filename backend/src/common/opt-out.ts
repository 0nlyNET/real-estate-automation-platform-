const OPT_OUT_PATTERNS = [
  /\bSTOP\b/,
  /\bSTOP\s+ALL\b/,
  /\bQUIT\b/,
  /\bUNSUBSCRIBE\b/,
  /\bREMOVE(?:\s+ME)?\b/,
  /\bOPT\s+OUT\b/,
  /\bCANCEL\b/,
  /\bEND\b/,
];

export function normalizeOptOutBody(body: string): string {
  return String(body || "")
    .trim()
    .toUpperCase()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "")
    .replace(/\s+/g, " ");
}

export function isOptOutMessage(
  body: string,
  optOutType?: string | null,
): boolean {
  const type = normalizeOptOutBody(optOutType || "");
  if (
    [
      "STOP",
      "STOP ALL",
      "QUIT",
      "UNSUBSCRIBE",
      "REMOVE",
      "CANCEL",
      "END",
    ].includes(type)
  ) {
    return true;
  }
  const normalized = normalizeOptOutBody(body);
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(normalized));
}
