export interface DriveCommand {
  throttle: number;
  steer: number;
  restart: boolean;
}

/**
 * Giant hold-to-drive controls. Buttons win over tilt. Keyboard is for desktop checks.
 */
export class Input {
  private go = false;
  private left = false;
  private right = false;
  private keyGo = false;
  private keyLeft = false;
  private keyRight = false;
  private restartQueued = false;
  tiltOn = false;
  private tiltSteer = 0;
  private readonly onSelect: (id: string) => void;

  constructor(onSelect: (id: string) => void) {
    this.onSelect = onSelect;
  }

  attach(unlock: () => void): void {
    const hold = (el: HTMLElement, set: (down: boolean) => void) => {
      const down = (event: PointerEvent) => {
        event.preventDefault();
        unlock();
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          /* synthetic events from tests have no pointer to capture */
        }
        set(true);
        el.classList.add('down');
      };
      const up = () => {
        set(false);
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };

    hold(must('go'), (down) => {
      this.go = down;
    });
    hold(must('left'), (down) => {
      this.left = down;
    });
    hold(must('right'), (down) => {
      this.right = down;
    });

    must('restart').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      unlock();
      this.restartQueued = true;
    });

    must('tilt').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      unlock();
      void this.toggleTilt();
    });

    document.querySelectorAll<HTMLButtonElement>('[data-car]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        unlock();
        const id = button.dataset.car;
        if (id) this.onSelect(id);
      });
    });

    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') this.keyGo = true;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') this.keyLeft = true;
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') this.keyRight = true;
      if (event.key === 'r' || event.key === 'R') this.restartQueued = true;
    });
    window.addEventListener('keyup', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') this.keyGo = false;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') this.keyLeft = false;
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') this.keyRight = false;
    });

    window.addEventListener('deviceorientation', (event) => {
      if (!this.tiltOn) return;
      this.tiltSteer = steerFromOrientation(event);
    });

    const block = (event: Event) => event.preventDefault();
    window.addEventListener('contextmenu', block);
    document.addEventListener('gesturestart', block as EventListener);
  }

  sample(): DriveCommand {
    let steer = 0;
    if (this.left || this.keyLeft) steer -= 1;
    if (this.right || this.keyRight) steer += 1;
    if (steer === 0 && this.tiltOn) steer = this.tiltSteer;
    steer = Math.max(-1, Math.min(1, steer));
    const restart = this.restartQueued;
    this.restartQueued = false;
    return { throttle: this.go || this.keyGo ? 1 : 0, steer, restart };
  }

  private async toggleTilt(): Promise<void> {
    const button = must('tilt');
    if (this.tiltOn) {
      this.tiltOn = false;
      this.tiltSteer = 0;
      button.classList.remove('on');
      button.setAttribute('aria-pressed', 'false');
      return;
    }
    const granted = await requestTiltPermission();
    if (!granted) {
      button.classList.add('nope');
      window.setTimeout(() => button.classList.remove('nope'), 450);
      return;
    }
    this.tiltOn = true;
    button.classList.add('on');
    button.setAttribute('aria-pressed', 'true');
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

async function requestTiltPermission(): Promise<boolean> {
  const orientation = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof orientation.requestPermission === 'function') {
    try {
      const result = await orientation.requestPermission();
      return result === 'granted';
    } catch {
      return false;
    }
  }
  return true;
}

function steerFromOrientation(event: DeviceOrientationEvent): number {
  const legacyOrientation = (window as unknown as { orientation?: number }).orientation;
  const angle = window.screen?.orientation?.angle ?? legacyOrientation ?? 0;
  let tilt = 0;
  if (angle === 90) tilt = event.beta ?? 0;
  else if (angle === -90 || angle === 270) tilt = -(event.beta ?? 0);
  else tilt = event.gamma ?? 0;
  const dead = 6;
  const sign = Math.sign(tilt);
  const mag = Math.max(0, Math.abs(tilt) - dead);
  return Math.max(-1, Math.min(1, (sign * mag) / 22));
}
