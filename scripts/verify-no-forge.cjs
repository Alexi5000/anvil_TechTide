// Fails the build if node-forge re-enters the dependency graph.
// node-forge <=1.4.0 is affected by GHSA-86w9-cpqp-85rv and has no patched release.
// RSA, X.509, and hashing needs must use the Node.js built-in `node:crypto` module instead.
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'agents/package.json',
  'agents/package-lock.json',
  'agents/pnpm-lock.yaml',
];

for (const file of files) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) continue;
  const text = readFileSync(fullPath, 'utf8');
  assert.ok(!/node-forge/.test(text), `${file}: node-forge must not be a dependency (GHSA-86w9-cpqp-85rv); use node:crypto`);
}

console.log('verify-no-forge: ok');
