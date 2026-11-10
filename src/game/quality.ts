export interface Quality {
  level: 'high' | 'medium' | 'low';
  dpr: number;
  shadowMap: number;
  bloom: boolean;
  antialias: boolean;
  particles: number;
  /** Desktop uses the 4096 panorama. Phones and low quality use 2048. */
  hiPano: boolean;
  treeCount: number;
}

export function initialQuality(): Quality {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const mobile = touch || /iPhone|iPad|Android/i.test(navigator.userAgent) || isIOS();
  const native = window.devicePixelRatio || 1;
  const hiPano = !mobile;
  const dpr = phoneDpr(native, mobile);
  if (mobile && (memory <= 2 || cores <= 2)) {
    return { level: 'low', dpr, shadowMap: 512, bloom: false, antialias: false, particles: 40, hiPano, treeCount: 46 };
  }
  if (mobile) {
    return { level: 'medium', dpr, shadowMap: 1024, bloom: true, antialias: true, particles: 80, hiPano, treeCount: 84 };
  }
  return { level: 'high', dpr: Math.min(1.75, Math.max(native, 1)), shadowMap: 2048, bloom: true, antialias: true, particles: 140, hiPano, treeCount: 120 };
}

/** iPhone 14-class screens are 3x. Draw at 2x so the picture stays sharp, without the full 3x cost. */
function phoneDpr(native: number, mobile: boolean): number {
  if (!mobile) return Math.min(1.75, native);
  if (native >= 2) return Math.min(2, native);
  if (native >= 1.5) return native;
  return native;
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
