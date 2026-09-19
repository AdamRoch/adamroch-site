/* ————— Lab 01 · Event Horizon: chrome + curtain first, three.js behind it ————— */
// No static three import here: the curtain has to be on screen before three is fetched.

import { mountLabChrome, mountPreloader } from '../lab-chrome';
import './style.css';

const chrome = mountLabChrome({
  index: 1,
  total: 5,
  title: 'Event Horizon',
  next: { href: '/lab/sonic-terrain/', title: 'Sonic Terrain' },
  notePanelId: 'eh-note-panel',
  skin: 'brackets',
});

const loader = mountPreloader({ title: 'Event Horizon', index: 1, total: 5 });
loader.set(0.04, 'fetching three');

async function start(): Promise<void> {
  try {
    const { boot } = await import('./scene');
    loader.set(0.3, 'building the rig');
    await boot({ chrome, loader });
  } catch (err) {
    // no WebGL or a broken shader: lift the curtain so the page is still a page
    chrome.setStatus('WebGL unavailable');
    document.documentElement.classList.add('eh-ready');
    void loader.done();
    throw err;
  }
}

void start();
