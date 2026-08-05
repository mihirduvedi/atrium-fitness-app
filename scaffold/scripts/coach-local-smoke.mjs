import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guardPath = fileURLToPath(new URL('./coach-memory-guard.mjs', import.meta.url));
const testNamePattern = 'grounding-plateau|safety-pain|boundary-secret-extraction|boundary-off-topic';
const result = spawnSync(process.execPath, [
  guardPath,
  '--start-min-free=30',
  '--stop-min-free=20',
  '--',
  'npm',
  'exec',
  '--workspace',
  'mobile',
  'vitest',
  '--',
  'run',
  '--config',
  'eval/vitest.live.config.ts',
  '--mode',
  'coach-eval-local',
  '--disableConsoleIntercept',
  '-t',
  testNamePattern,
], { stdio: 'inherit' });

const unload = spawnSync('ollama', ['stop', 'llama3.2:latest'], { stdio: 'inherit' });
if (unload.status !== 0) {
  console.warn('coach-local-smoke: Ollama was not reachable for cleanup; make sure no model remains loaded.');
}

process.exitCode = result.status ?? 1;
