import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readEnvironmentFile(path) {
  const values = new Map();
  const contents = readFileSync(resolve(path), 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    values.set(trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim());
  }
  return values;
}

const serverPath = 'supabase/.env.coach-groq';
const evalPath = 'apps/mobile/.env.coach-eval-groq';
let server;
let evaluator;
try {
  server = readEnvironmentFile(serverPath);
  evaluator = readEnvironmentFile(evalPath);
} catch (error) {
  console.error(`coach-groq-check: ${error.message}`);
  process.exit(2);
}

const failures = [];
function requireValue(values, name, expected, source) {
  const value = values.get(name) ?? '';
  if (!value) failures.push(`${source}: ${name} is missing`);
  else if (expected && value !== expected) failures.push(`${source}: ${name} must be ${expected}`);
}

requireValue(server, 'COACH_LLM_PROVIDER', 'openai-compatible', serverPath);
requireValue(server, 'COACH_LLM_BASE_URL', 'https://api.groq.com/openai/v1', serverPath);
requireValue(server, 'COACH_LLM_MODEL', 'openai/gpt-oss-20b', serverPath);
requireValue(server, 'COACH_LLM_MAX_OUTPUT_TOKENS', '600', serverPath);
requireValue(server, 'COACH_LLM_REASONING_EFFORT', 'low', serverPath);
const apiKey = server.get('COACH_LLM_API_KEY') ?? '';
if (!apiKey || /replace|example/i.test(apiKey)) {
  failures.push(`${serverPath}: COACH_LLM_API_KEY is missing; create one at https://console.groq.com/keys`);
}

requireValue(evaluator, 'ATRIUM_COACH_EVAL_PROVIDER', 'groq', evalPath);
requireValue(evaluator, 'ATRIUM_COACH_EVAL_MODEL', 'openai/gpt-oss-20b', evalPath);
requireValue(evaluator, 'ATRIUM_COACH_EVAL_MIN_INTERVAL_MS', '30000', evalPath);

if (failures.length) {
  for (const failure of failures) console.error(`coach-groq-check: ${failure}`);
  process.exit(2);
}

console.info('coach-groq-check\tserver-profile=ready\teval-profile=ready\tcredential=present');
