import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = 'src/commerce-extensibility-1/.generated/app.commerce.manifest.json';
const path = 'release-evidence/stage.json';
const sha = process.env.GITHUB_SHA;
if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('A full GitHub commit SHA is required');
const checks = ['yaml', 'secret-scan', 'npm test', 'generated-artifacts', 'aio app test', 'aio app build', 'aio app deploy'];

if (process.argv[2] === 'create') {
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !Number.isSafeInteger(Number(process.env.GITHUB_RUN_ID))) throw new Error('Stage evidence requires a main-branch GitHub run');
  mkdirSync('release-evidence', { recursive: true });
  writeFileSync(path, `${JSON.stringify({ sha, run_id: Number(process.env.GITHUB_RUN_ID), manifest_sha256: sha256(manifest), checks })}\n`, { mode: 0o600 });
  console.log('Created SHA-bound stage evidence without secrets.');
} else if (process.argv[2] === 'verify') {
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  if (evidence.sha !== sha || evidence.run_id !== Number(process.env.STAGE_RUN_ID) || evidence.manifest_sha256 !== sha256(manifest) || JSON.stringify(evidence.checks) !== JSON.stringify(checks)) {
    throw new Error('Stage evidence does not match release commit, successful Stage run and generated manifest');
  }
  console.log('Stage evidence matches this release and generated manifest.');
} else throw new Error('Expected create or verify');
