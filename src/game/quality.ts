export interface Quality {
  level: 'high' | 'medium' | 'low';
  dpr: number;
  shadowMap: number;
  bloom: boolean;
  antialias: boolean;
  particles: number;
  treeCount: number;
}

export function initialQuality(): Quality {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const mobile = touch || /iPhone|iPad|Android/i.test(navigator.userAgent) || isIOS();
  const native = window.devicePixelRatio || 1;
  const dpr = phoneDpr(native, mobile);
  if (mobile && (memory <= 2 || cores <= 2)) {
    return { level: 'low', dpr, shadowMap: 512, bloom: false, antialias: false, particles: 40, treeCount: 46 };
  }
  if (mobile) {
    return { level: 'medium', dpr, shadowMap: 256, bloom: false, antialias: true, particles: 64, treeCount: 56 };
  }
  return { level: 'high', dpr: Math.min(1.75, Math.max(native, 1)), shadowMap: 2048, bloom: true, antialias: true, particles: 140, treeCount: 120 };
}

/** Phones stay at 1.5x. A 3x iPhone framebuffer is most of the frame time. */
function phoneDpr(native: number, mobile: boolean): number {
  if (!mobile) return Math.min(1.75, native);
  return Math.min(1.5, Math.max(native, 1));
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Drop bloom, then shadows, then resolution. Stay at 1.5+ until fps is actually unplayable. */
export function stepDown(quality: Quality, severe: boolean): Quality {
  if (quality.bloom) return { ...quality, level: 'medium', bloom: false };
  if (quality.shadowMap > 512) return { ...quality, level: 'low', shadowMap: 512, particles: Math.min(quality.particles, 40) };
  if (quality.dpr > 1.5) return { ...quality, level: 'low', dpr: 1.5 };
  if (severe && quality.dpr > 1) return { ...quality, level: 'low', dpr: 1 };
  return quality;
}
