export interface Quality {
  level: 'high' | 'medium' | 'low';
  dpr: number;
  shadowMap: number;
  bloom: boolean;
  antialias: boolean;
  particles: number;
}

export function initialQuality(): Quality {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const mobile = touch || /iPhone|iPad|Android/i.test(navigator.userAgent);
  const native = window.devicePixelRatio || 1;
  if (mobile && (memory <= 2 || cores <= 2)) {
    return { level: 'low', dpr: Math.min(1, native), shadowMap: 512, bloom: false, antialias: false, particles: 40 };
  }
  if (mobile) {
    return { level: 'medium', dpr: Math.min(1.25, native), shadowMap: 1024, bloom: true, antialias: true, particles: 80 };
  }
  return { level: 'high', dpr: Math.min(1.75, native), shadowMap: 2048, bloom: true, antialias: true, particles: 140 };
}

export function stepDown(quality: Quality): Quality {
  if (quality.dpr > 1.05) return { ...quality, level: 'medium', dpr: 1 };
  if (quality.bloom) return { ...quality, level: 'low', bloom: false };
  if (quality.shadowMap > 512) return { ...quality, level: 'low', shadowMap: 512, particles: 40 };
  return quality;
}
