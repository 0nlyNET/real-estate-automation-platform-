import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const workflowDirectory = '.github/workflows';
const workflowFiles = readdirSync(workflowDirectory).filter((file) =>
  /\.ya?ml$/i.test(file),
);
const findings = [];

for (const file of workflowFiles) {
  const path = join(workflowDirectory, file);
  const content = readFileSync(path, 'utf8');

  if (/^\s*pull_request_target\s*:/m.test(content)) {
    findings.push(`${path}: pull_request_target can expose privileged workflow context`);
  }
  if (/^\s*permissions\s*:\s*(?:write-all|read-all)\s*$/m.test(content)) {
    findings.push(`${path}: broad workflow permissions are prohibited`);
  }
  if (/^\s*[a-z-]+\s*:\s*write\s*$/m.test(content)) {
    findings.push(`${path}: write permissions require explicit security review`);
  }

  for (const [index, line] of content.split('\n').entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
    if (!match || match[1].startsWith('./')) continue;
    const reference = match[1].split('@').at(-1) || '';
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      findings.push(`${path}:${index + 1}: third-party action is not pinned to a commit SHA`);
    }
  }

  const checkoutBlocks = content.split(/(?=^\s*-\s+uses:\s+actions\/checkout@)/m).slice(1);
  for (const block of checkoutBlocks) {
    const step = block.split(/(?=^\s*-\s+(?:uses|run|name):)/m)[0];
    if (!/^\s+persist-credentials:\s*false\s*$/m.test(step)) {
      findings.push(`${path}: actions/checkout must disable persisted credentials`);
    }
  }
}

if (findings.length) {
  console.error(`Workflow security scan failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(
    `Workflow security scan passed: ${workflowFiles.length} workflow file(s) use immutable actions, read-only permissions, and non-persisted checkout credentials.`,
  );
}
