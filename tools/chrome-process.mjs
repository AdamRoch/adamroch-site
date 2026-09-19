// Own only the headless browser launched by this job. Never signal by app name.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function spawnChrome(command, args) {
  if (!args.includes('--headless=new')) throw new Error('Expected a headless Chrome job');
  const timeoutMs = Number(process.env.CHROME_JOB_TIMEOUT_MS ?? 300_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('CHROME_JOB_TIMEOUT_MS must be positive');
  const profile = mkdtempSync(join(tmpdir(), `personal-site-chrome-${process.pid}-`));
  let chrome;
  try {
    chrome = spawn(command, [...args.filter((arg) => !arg.startsWith('--user-data-dir=')), `--user-data-dir=${profile}`]);
  } catch (error) {
    rmSync(profile, { recursive: true, force: true });
    throw error;
  }
  let stopped = false;
  let closing = false;
  let killTimer;
  let deadline;
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const onExit = () => { if (!stopped) chrome.kill('SIGTERM'); };
  const onInterrupt = () => { void close().then(() => process.exit(130)); };
  const onTerminate = () => { void close().then(() => process.exit(143)); };
  const onHangup = () => { void close().then(() => process.exit(129)); };
  function finish() {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    clearTimeout(killTimer);
    process.off('exit', onExit);
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    process.off('SIGHUP', onHangup);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      console.error(`Could not remove temporary Chrome profile ${profile}: ${error.message}`);
    }
    resolveExit();
  }
  function close() {
    if (!stopped && !closing) {
      closing = true;
      chrome.kill('SIGTERM');
      killTimer = setTimeout(() => { if (!stopped) chrome.kill('SIGKILL'); }, 5_000);
      killTimer.unref();
    }
    return exited;
  }
  chrome.once('exit', finish);
  chrome.once('error', finish);
  // Last-resort termination also covers callers that use process.exit() or throw.
  // SIGKILL cannot run Node's exit handlers; ordinary callers must await close().
  process.on('exit', onExit);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  process.on('SIGHUP', onHangup);
  deadline = setTimeout(() => {
    console.error(`Chrome job exceeded ${timeoutMs} ms; closing its browser`);
    void close().then(() => process.exit(124));
  }, timeoutMs);
  deadline.unref();
  chrome.close = close;
  chrome.profile = profile;
  return chrome;
}
