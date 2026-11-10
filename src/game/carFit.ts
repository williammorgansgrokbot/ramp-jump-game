/** Axle layout from the art-v3 manifests. +X is the car's left, +Z is forward. */

export interface Axle {
  name: 'Wheel_FL' | 'Wheel_FR' | 'Wheel_RL' | 'Wheel_RR';
  x: number;
  z: number;
  radius: number;
}

/**
 * Chassis-local Y where the tire bottoms sit before suspension sag.
 * Connection points stay at y = 0, so rest length is this minus the radius
 * and the chassis origin stays about a meter above the ground, same as before.
 */
export const TIRE_DROP = 1;

export const CAR_AXLES: Record<string, Axle[]> = {
  boy1: [
    { name: 'Wheel_FL', x: 0.8462, z: 1.1272, radius: 0.5116 },
    { name: 'Wheel_FR', x: -0.8458, z: 1.1272, radius: 0.5116 },
    { name: 'Wheel_RL', x: 0.8726, z: -1.221, radius: 0.4911 },
    { name: 'Wheel_RR', x: -0.8709, z: -1.221, radius: 0.4911 },
  ],
  boy2: [
    { name: 'Wheel_FL', x: 0.9226, z: 1.0311, radius: 0.4792 },
    { name: 'Wheel_FR', x: -0.9236, z: 1.0311, radius: 0.4792 },
    { name: 'Wheel_RL', x: 0.921, z: -1.2319, radius: 0.4805 },
    { name: 'Wheel_RR', x: -0.9217, z: -1.2319, radius: 0.4805 },
  ],
  boy3: [
    { name: 'Wheel_FL', x: 0.9093, z: 1.063, radius: 0.4713 },
    { name: 'Wheel_FR', x: -0.9121, z: 1.063, radius: 0.4713 },
    { name: 'Wheel_RL', x: 0.8953, z: -1.1792, radius: 0.4727 },
    { name: 'Wheel_RR', x: -0.9047, z: -1.1792, radius: 0.4727 },
  ],
  boy4: [
    { name: 'Wheel_FL', x: 0.8985, z: 1.016, radius: 0.512 },
    { name: 'Wheel_FR', x: -0.9002, z: 1.016, radius: 0.512 },
    { name: 'Wheel_RL', x: 0.9102, z: -1.2109, radius: 0.5087 },
    { name: 'Wheel_RR', x: -0.9134, z: -1.2109, radius: 0.5087 },
  ],
};

export function axlesFor(id: string): Axle[] {
  return CAR_AXLES[id] ?? CAR_AXLES.boy1;
}

export function restLength(radius: number): number {
  return Math.max(0.18, TIRE_DROP - radius);
}
