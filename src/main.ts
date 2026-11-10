import './style.css';
import { Game } from './game/Game';

const block = (event: Event) => event.preventDefault();
document.addEventListener('gesturestart', block);
document.addEventListener('selectstart', block);
document.addEventListener(
  'touchmove',
  (event) => {
    if (event.touches.length > 1) event.preventDefault();
  },
  { passive: false },
);

const game = new Game();
void game.start().catch((err) => {
  console.error(err);
  game.failBoot(err);
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?v=3`).then((registration) => {
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) worker.postMessage('skip-waiting');
      });
    });
    if (hadController) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        location.reload();
      });
    }
  }).catch(() => undefined);
}
