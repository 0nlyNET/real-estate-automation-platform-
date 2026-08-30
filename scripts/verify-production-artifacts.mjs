import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const frontendStatic = join(process.cwd(), 'frontend', '.next', 'static');
if (!existsSync(frontendStatic)) {
  throw new Error('frontend/.next/static is missing; build the production frontend first');
}

const forbiddenNames = [
  'DATABASE_URL',
  'JWT_SECRET',
  'INTEGRATIONS_ENCRYPTION_KEY',
  'STRIPE_SECRET_KEY',
  'SENDGRID_API_KEY',
  'TWILIO_AUTH_TOKEN',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'MICROSOFT_CALENDAR_CLIENT_SECRET',
  'CALENDLY_CLIENT_SECRET',
];
const secretShapes = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
];

function filesUnder(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

const files = filesUnder(frontendStatic);
const maps = files.filter((file) => file.endsWith('.map'));
const violations = [];
for (const file of files.filter((item) => /\.(?:js|css|json|map)$/.test(item))) {
  const text = readFileSync(file, 'utf8');
  for (const name of forbiddenNames) {
    if (text.includes(name)) violations.push(`${file}: server-only variable ${name}`);
  }
  if (secretShapes.some((pattern) => pattern.test(text))) {
    violations.push(`${file}: high-confidence secret shape [REDACTED]`);
  }
}
if (maps.length) {
  violations.push(`frontend/.next/static: ${maps.length} public source map(s)`);
}
if (violations.length) {
  console.error(`Production artifact verification failed (${violations.length}):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Production artifact verification passed: ${files.length} public static files, no public source maps or server-secret indicators.`,
  );
}
