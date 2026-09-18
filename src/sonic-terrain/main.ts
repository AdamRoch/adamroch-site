/* ————— Lab 02 · Sonic Terrain: chrome and preloader first, then the scene ————— */
// No static three import here on purpose: static imports hoist, and the curtain has to be
// on screen before the scene bundle is even requested.

import { mountLabChrome, mountPreloader } from '../lab-chrome';
import './style.css';

const chrome = mountLabChrome({
  index: 2,
  total: 5,
  title: 'Sonic Terrain',
  next: { href: '/lab/living-world/', title: 'Living World' },
  notePanelId: 'st-note-panel',
  status: 'ANALYSER 2048-FFT',
  skin: 'brackets st',
});

const pre = mountPreloader({
  title: 'Sonic Terrain',
  index: 2,
  total: 5,
  stages: ['building terrain', 'compiling'],
});

import('./scene')
  .then(({ boot }) => {
    pre.set(0.25, 'building terrain'); // the scene bundle is in
    return boot(chrome, pre);
  })
  .catch((err: unknown) => {
    console.error(err);
    chrome.setStatus('SCENE FAILED TO LOAD');
    return pre.done();
  });
