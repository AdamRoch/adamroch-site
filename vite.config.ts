import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// 'UPDATED AUG 2026' per lab from the last commit touching its source or its page. Read once
// at config time; the homepage shows it instead of a meaningless Live badge.
//
// git is the source of truth, but the deploy builds in a container with no usable history, so
// a git-only read shipped five empty labels. Every build that CAN read git writes the answers
// back to lab-updated.json, and builds that cannot fall back to that committed file. Keep the
// file in the commit: it is the only thing the deploy has to go on.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LAB_SLUGS = ['event-horizon', 'sonic-terrain', 'living-world', 'walkthrough', 'broadsheet'];
const CACHE = entry('./lab-updated.json');

function fromGit(slug: string): string {
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

function readCache(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

const cached = readCache();
const LAB_UPDATED: Record<string, string> = Object.fromEntries(
  LAB_SLUGS.map((s) => [s, fromGit(s) || cached[s] || ''])
);
if (LAB_SLUGS.some((s) => LAB_UPDATED[s] !== cached[s]) && Object.values(LAB_UPDATED).some(Boolean)) {
  try {
    writeFileSync(CACHE, `${JSON.stringify(LAB_UPDATED, null, 2)}\n`);
  } catch {
    /* read-only checkout: the committed file still carries the labels */
  }
}

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
