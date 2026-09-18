import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 'UPDATED AUG 2026' per lab from the last commit touching its source or its page. Read once
// at config time; the homepage shows it instead of a meaningless Live badge. The whole label
// comes from here, so a build with no usable git history drops it rather than shipping the
// bare word 'UPDATED'.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LAB_SLUGS = ['event-horizon', 'sonic-terrain', 'living-world', 'walkthrough', 'broadsheet'];
function labUpdated(slug: string): string {
  try {
    const iso = execSync(`git log -1 --format=%cs -- src/${slug} lab/${slug}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const [y, m] = iso.split('-');
    const month = MONTHS[Number(m) - 1];
    return y && month ? `UPDATED ${month} ${y}` : '';
  } catch {
    return '';
  }
}
const LAB_UPDATED: Record<string, string> = Object.fromEntries(LAB_SLUGS.map((s) => [s, labUpdated(s)]));

// %LAB_UPDATED:<slug>% in an HTML entry becomes the date, so the static markup is complete
// without JS. The same map is exposed to TS as __LAB_UPDATED__.
const labUpdatedHtml: Plugin = {
  name: 'lab-updated-html',
  transformIndexHtml(html) {
    return html.replace(/%LAB_UPDATED:([a-z-]+)%/g, (_, slug: string) => LAB_UPDATED[slug] ?? '');
  },
};

export default defineConfig({
  plugins: [labUpdatedHtml],
  define: {
    __LAB_UPDATED__: JSON.stringify(LAB_UPDATED),
  },
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        '404': entry('./404.html'),
        'lab/living-world': entry('./lab/living-world/index.html'),
        'lab/event-horizon': entry('./lab/event-horizon/index.html'),
        'lab/sonic-terrain': entry('./lab/sonic-terrain/index.html'),
        'lab/walkthrough': entry('./lab/walkthrough/index.html'),
        'lab/broadsheet': entry('./lab/broadsheet/index.html'),
      },
    },
  },
});
