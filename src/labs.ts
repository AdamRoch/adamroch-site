// The shared lab table. The homepage index rows, the totality tint and the lab chrome's
// index numbers all read from here, so the numbers agree across the seam.
// `first` is each lab's first painted frame (its --lab-bg / html background today);
// the lab workflow must keep the two equal or the exit fills with the wrong colour.

declare const __LAB_UPDATED__: Record<string, string>;

export interface Lab {
  slug: string;
  index: number;
  title: string;
  href: string;
  description: string;
  tags: string;
  first: string; // hex, the lab's first painted frame
  light: [number, number, number]; // linear-light tint of the lab's hour
  dust: number;
  intensity: number;
  radius: number;
}

export const LABS: Lab[] = [
  { slug: 'event-horizon', index: 1, title: 'Event Horizon', href: '/lab/event-horizon/', description: 'A black hole, raymarched live. Gravity as a raw material.', tags: 'GLSL · RAYMARCH', first: '#0b0b0d', light: [1.0, 0.3, 0.08], dust: 0.6, intensity: 1.2, radius: 0.9 },
  { slug: 'sonic-terrain', index: 2, title: 'Sonic Terrain', href: '/lab/sonic-terrain/', description: 'An FFT terrain you can play. The browser as an instrument.', tags: 'WEB AUDIO · WIREFRAME', first: '#0b0b0d', light: [1.0, 0.62, 0.2], dust: 0.4, intensity: 1.0, radius: 1.0 },
  { slug: 'living-world', index: 3, title: 'Living World', href: '/lab/living-world/', description: 'Moss arches and a slow morning, grown from noise.', tags: 'THREE · INSTANCING', first: '#546943', light: [0.62, 0.72, 0.52], dust: 1.8, intensity: 0.8, radius: 1.1 },
  { slug: 'walkthrough', index: 4, title: 'Walkthrough', href: '/lab/walkthrough/', description: 'A dusk beach, first person, and a colossus half buried in it.', tags: 'POINTER LOCK · FIRST PERSON', first: '#6f6873', light: [0.83, 0.67, 0.5], dust: 1.3, intensity: 0.9, radius: 1.15 },
  { slug: 'broadsheet', index: 5, title: 'Broadsheet', href: '/lab/broadsheet/', description: 'An essay set like a newspaper. Attention is a material.', tags: 'EDITORIAL · PRINT', first: '#f4f1ea', light: [0.96, 0.92, 0.84], dust: 0.3, intensity: 1.1, radius: 1.0 },
];

// 'UPDATED AUG 2026' per slug, computed at build time from git (vite.config.ts); '' when unknown.
export const LAB_UPDATED: Record<string, string> =
  typeof __LAB_UPDATED__ === 'undefined' ? {} : __LAB_UPDATED__;

export function labBySlug(slug: string): Lab | undefined {
  return LABS.find((l) => l.slug === slug);
}

// sRGB hex → linear 0..1, for LensTint.
export function hexToLinear(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return { r: c((n >> 16) & 255), g: c((n >> 8) & 255), b: c(n & 255) };
}
