# Browser jobs

`shot.mjs`, `eval.mjs`, and `probe.mjs` launch Chrome through `chrome-process.mjs`. `og.mjs` uses the same launch function through `probe.mjs`.

Each job gets a unique temporary browser profile. Close the browser in `finally` and await its exit before the script ends. The launcher deletes that profile after exit, handles SIGINT/SIGTERM/SIGHUP, and gives Chrome five seconds to stop before killing that specific child. It never signals Chrome by application name.

Jobs have a five-minute limit so a stalled CDP request cannot hold a browser open indefinitely. Set `CHROME_JOB_TIMEOUT_MS` explicitly for a longer measurement. New drivers should use this launcher instead of calling `spawn` directly:

```js
import { spawnChrome } from './chrome-process.mjs';

const chrome = spawnChrome('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', 'about:blank',
]);
try {
  // Connect to CDP and run the job.
} finally {
  await chrome.close();
}
```

The exit hook also sends SIGTERM if a caller uses `process.exit()` or throws outside its cleanup block. That fallback cannot wait or remove the profile after the caller exits. SIGKILL bypasses Node's handlers entirely. Use `finally` and ordinary cancellation; this helper is not a separate process supervisor.

Run lifecycle tests with `node --test tools/chrome-process.test.mjs`. They use disposable fake browsers to check ownership, shutdown, cancellation, errors, and timeouts. The 18 September fix also passed real Chrome screenshot, evaluation, pixel-probe, driver, output-error, and cancellation checks.
