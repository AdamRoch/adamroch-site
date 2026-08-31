import './style.css';
import { initParticles } from './particles';
import { initAnimations } from './animations';
import { initModals } from './modal';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const particlesCanvas = document.querySelector<HTMLCanvasElement>('#particles');
const particles = particlesCanvas ? initParticles(particlesCanvas, reduced) : null;
initAnimations({ reduced, onMorph: (progress) => particles?.setMorph(progress) });
initModals();
