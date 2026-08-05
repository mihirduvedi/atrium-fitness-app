import { spawn, spawnSync } from 'node:child_process';

const rawArgs = process.argv.slice(2);
const separatorIndex = rawArgs.indexOf('--');
if (separatorIndex < 0 || separatorIndex === rawArgs.length - 1) {
  console.error('Usage: node scripts/coach-memory-guard.mjs [--start-min-free=30] [--stop-min-free=20] -- <command> [args...]');
  process.exit(2);
}

function numericOption(name, fallback) {
  const prefix = `--${name}=`;
  const value = rawArgs.slice(0, separatorIndex).find((argument) => argument.startsWith(prefix));
  if (!value) return fallback;
  const parsed = Number(value.slice(prefix.length));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

const startMinFree = numericOption('start-min-free', 30);
const stopMinFree = numericOption('stop-min-free', 20);
const command = rawArgs[separatorIndex + 1];
const commandArgs = rawArgs.slice(separatorIndex + 2);

function freeMemoryPercent() {
  if (process.platform !== 'darwin') return null;
  const result = spawnSync('/usr/bin/memory_pressure', ['-Q'], { encoding: 'utf8' });
  const match = result.stdout.match(/System-wide memory free percentage:\s*(\d+)%/);
  return match ? Number(match[1]) : null;
}

const initialFree = freeMemoryPercent();
if (initialFree == null) {
  console.error('coach-memory-guard: could not read macOS memory pressure; refusing to start local inference.');
  process.exit(2);
}
console.info(`coach-memory-guard\tpreflight=${initialFree}%\tstart-min=${startMinFree}%\tstop-min=${stopMinFree}%`);
if (initialFree < startMinFree) {
  console.error(`coach-memory-guard: ${initialFree}% free is below the ${startMinFree}% start threshold. Close memory-heavy apps or stop Docker workloads before retrying.`);
  process.exit(2);
}

const detached = process.platform !== 'win32';
const child = spawn(command, commandArgs, { stdio: 'inherit', detached });
let lowestFree = initialFree;
let memoryAbort = false;
let forwardingSignal = false;

function signalChild(signal) {
  if (!child.pid || child.exitCode != null || child.signalCode != null) return;
  try {
    if (detached) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The child may have exited between the status check and signal.
  }
}

const monitor = setInterval(() => {
  const free = freeMemoryPercent();
  if (free == null) return;
  lowestFree = Math.min(lowestFree, free);
  if (!memoryAbort && free < stopMinFree) {
    memoryAbort = true;
    console.error(`coach-memory-guard: aborting local inference at ${free}% free memory (threshold ${stopMinFree}%).`);
    signalChild('SIGINT');
    setTimeout(() => signalChild('SIGTERM'), 2_000).unref();
  }
}, 1_000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (forwardingSignal) return;
    forwardingSignal = true;
    signalChild(signal);
  });
}

child.on('error', (error) => {
  clearInterval(monitor);
  console.error(`coach-memory-guard: could not start ${command}: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  clearInterval(monitor);
  const finalFree = freeMemoryPercent();
  if (finalFree != null) lowestFree = Math.min(lowestFree, finalFree);
  console.info(`coach-memory-guard\tlowest=${lowestFree}%\tfinal=${finalFree ?? 'unknown'}%\taborted=${memoryAbort}`);
  if (memoryAbort) process.exitCode = 137;
  else if (signal) process.exitCode = 1;
  else process.exitCode = code ?? 1;
});
