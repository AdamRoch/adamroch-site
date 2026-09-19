import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnChrome } from './chrome-process.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await sleep(100);
  }
  assert.ok(predicate(), 'condition did not settle');
}
function fixture(t, ignoreTerm = false) {
  const dir = mkdtempSync(join(tmpdir(), 'chrome-process-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake-chrome');
  writeFileSync(executable, `#!${process.execPath}\n${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}\nconsole.log('ready');\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  return { dir, executable };
}

test('close waits for exit, removes only its profile and leaves another browser alive', async (t) => {
  const { executable } = fixture(t);
  const first = spawnChrome(executable, ['--headless=new']);
  const second = spawnChrome(executable, ['--headless=new']);
  t.after(async () => { await first.close(); await second.close(); });
  await Promise.all([once(first.stdout, 'data'), once(second.stdout, 'data')]);
  assert.notEqual(first.profile, second.profile);
  await first.close();
  await first.close();
  assert.equal(alive(first.pid), false);
  assert.equal(existsSync(first.profile), false);
  assert.equal(alive(second.pid), true);
  assert.equal(existsSync(second.profile), true);
  await second.close();
});

test('failed spawn removes its temporary profile', async () => {
  const child = spawnChrome('/nonexistent/chrome-test-executable', ['--headless=new']);
  await once(child, 'error');
  await child.close();
  assert.equal(existsSync(child.profile), false);
});

test('a browser ignoring SIGTERM is killed after the grace period', async (t) => {
  const { executable } = fixture(t, true);
  const child = spawnChrome(executable, ['--headless=new']);
  t.after(() => child.close());
  await once(child.stdout, 'data');
  await child.close();
  assert.equal(child.signalCode, 'SIGKILL');
  assert.equal(existsSync(child.profile), false);
});

for (const mode of ['SIGINT', 'SIGTERM', 'SIGHUP', 'timeout', 'exit', 'throw']) {
  test(`controller ${mode} does not leave its browser alive`, async (t) => {
    const { dir, executable } = fixture(t);
    const runner = join(dir, 'runner.mjs');
    writeFileSync(runner, `
      import { spawnChrome } from ${JSON.stringify(new URL('./chrome-process.mjs', import.meta.url).href)};
      const child = spawnChrome(${JSON.stringify(executable)}, ['--headless=new']);
      child.stdout.once('data', () => {
        console.log(JSON.stringify({ pid: child.pid, profile: child.profile }));
        ${mode === 'exit' ? 'process.exit(0);' : mode === 'throw' ? "throw new Error('intentional test failure');" : ''}
      });
    `);
    const controller = spawn(process.execPath, [runner], {
      env: { ...process.env, CHROME_JOB_TIMEOUT_MS: mode === 'timeout' ? '500' : '30000' },
    });
    const done = once(controller, 'exit');
    let browser;
    t.after(() => {
      controller.kill();
      if (browser && alive(browser.pid)) process.kill(browser.pid, 'SIGKILL');
      if (browser) rmSync(browser.profile, { recursive: true, force: true });
    });
    browser = JSON.parse(String((await once(controller.stdout, 'data'))[0]));
    if (mode.startsWith('SIG')) controller.kill(mode);
    const [code] = await done;
    assert.equal(code, { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, timeout: 124, exit: 0, throw: 1 }[mode]);
    await until(() => !alive(browser.pid));
    // A synchronous exit hook can send SIGTERM but cannot await profile removal.
    if (!['exit', 'throw'].includes(mode)) assert.equal(existsSync(browser.profile), false);
  });
}
