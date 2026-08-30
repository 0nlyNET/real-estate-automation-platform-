import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';

const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['SendGrid API key', /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];

const sensitiveAssignment =
  /^[ \t]*([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY))[ \t]*[=:][ \t]*['"]?([^'"\s#]+)['"]?[ \t]*$/gm;
const databaseCredential =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/([^:\s/]+):([^@\s/]+)@([^\s/'"]+)/gi;
const placeholderWords =
  /(?:^$|example|placeholder|replace|change[-_]?me|dummy|mock|test[-_]?only|configured[-_]?but|development|dev[-_]|local[-_]|\$\{|<[^>]+>)/i;

function isAllowedDatabaseFixture(user, password, host) {
  return (
    user === 'postgres' &&
    password === 'postgres' &&
    /^(?:localhost|127\.0\.0\.1|postgres)(?::\d+)?$/i.test(host)
  );
}

function findingsIn(text) {
  const findings = [];
  for (const [name, pattern] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(name);
  }
  sensitiveAssignment.lastIndex = 0;
  for (const match of text.matchAll(sensitiveAssignment)) {
    const value = match[2] || '';
    if (value.length >= 12 && !placeholderWords.test(value)) {
      findings.push(`non-placeholder ${match[1]} assignment`);
    }
  }
  databaseCredential.lastIndex = 0;
  for (const match of text.matchAll(databaseCredential)) {
    if (
      !placeholderWords.test(match[1]) &&
      !placeholderWords.test(match[2]) &&
      !isAllowedDatabaseFixture(match[1], match[2], match[3])
    ) {
      findings.push('database URL with embedded credentials');
    }
  }
  return [...new Set(findings)];
}

function trackedFiles() {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    },
  )
    .split('\0')
    .filter(Boolean);
}

const currentFindings = [];
for (const file of trackedFiles()) {
  let content;
  try {
    if (!lstatSync(file).isFile()) continue;
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    content = bytes.toString('utf8');
  } catch {
    continue;
  }
  for (const kind of findingsIn(content)) currentFindings.push({ file, kind });
}

const historyFindings = [];
const history = execFileSync(
  'git',
  ['log', '--all', '--format=commit:%H', '--no-ext-diff', '-p'],
  { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
);
let commit = 'unknown';
let file = 'unknown';
for (const line of history.split('\n')) {
  if (line.startsWith('commit:')) commit = line.slice(7, 19);
  else if (line.startsWith('+++ b/')) file = line.slice(6);
  else if (line.startsWith('+') && !line.startsWith('+++')) {
    for (const kind of findingsIn(line.slice(1))) {
      historyFindings.push({ commit, file, kind });
    }
  }
}

const unique = new Map();
for (const finding of [...currentFindings, ...historyFindings]) {
  unique.set(`${finding.file}:${finding.kind}`, finding);
}
if (unique.size) {
  console.error(`Secret scan failed with ${unique.size} redacted finding(s):`);
  for (const finding of unique.values()) {
    console.error(`- ${finding.file}: ${finding.kind} [REDACTED]`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed: ${trackedFiles().length} repository files and reachable Git history checked; no high-confidence secrets found.`,
  );
}
