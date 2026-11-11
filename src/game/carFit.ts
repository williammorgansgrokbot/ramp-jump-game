/** Axle layout from the art-v3 and art-v5 manifests. +X is the vehicle's left, +Z is forward. */

export type VehicleType = 'car' | 'jeep' | 'monster';

export interface Axle {
  name: 'Wheel_FL' | 'Wheel_FR' | 'Wheel_RL' | 'Wheel_RR';
  x: number;
  z: number;
  radius: number;
}

export interface VehicleSpec {
  /** Chassis-local drop from the origin to the tire contact, before sag. */
  drop: number;
  stiffness: number;
  compression: number;
  relaxation: number;
  travel: number;
  frontGrip: number;
  rearGrip: number;
  engine: number;
  half: { x: number; y: number; z: number };
  /** Collider center, chassis local. Kept at axle height so a low belly is not solid. */
  boxY: number;
  mass: number;
  angularDamping: number;
}

/**
 * Cars keep the proven 1 m drop. The jeep is close to that, a little bouncier.
 * The monster's wheels are 0.83 m, so the drop is taller and the suspension can travel.
 */
export const VEHICLE_SPEC: Record<VehicleType, VehicleSpec> = {
  car: {
    drop: 1,
    stiffness: 52,
    compression: 8,
    relaxation: 9,
    travel: 0.2,
    frontGrip: 180,
    rearGrip: 140,
    engine: 560,
    half: { x: 0.82, y: 0.46, z: 1.48 },
    boxY: -0.2,
    mass: 125,
    angularDamping: 0.55,
  },
  jeep: {
    drop: 1,
    stiffness: 34,
    compression: 5.2,
    relaxation: 6.4,
    travel: 0.34,
    frontGrip: 240,
    rearGrip: 200,
    engine: 580,
    half: { x: 0.7, y: 0.28, z: 1.02 },
    boxY: -0.47,
    mass: 150,
    angularDamping: 0.62,
  },
  monster: {
    drop: 1.32,
    stiffness: 18,
    compression: 3.6,
    relaxation: 4.8,
    travel: 0.55,
    frontGrip: 150,
    rearGrip: 130,
    engine: 920,
    half: { x: 0.95, y: 0.32, z: 1.25 },
    boxY: -0.5,
    mass: 260,
    angularDamping: 0.9,
  },
};

const CAR_AXLES: Record<string, Axle[]> = {
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

const JEEP_AXLES: Axle[] = [
  { name: 'Wheel_FL', x: 0.8088, z: 1.091, radius: 0.5337 },
  { name: 'Wheel_FR', x: -0.8326, z: 1.091, radius: 0.5337 },
  { name: 'Wheel_RL', x: 0.889, z: -1.0246, radius: 0.5334 },
  { name: 'Wheel_RR', x: -0.8915, z: -1.0246, radius: 0.5334 },
];

const MONSTER_AXLES: Axle[] = [
  { name: 'Wheel_FL', x: 1.0819, z: 1.2663, radius: 0.8247 },
  { name: 'Wheel_FR', x: -1.1135, z: 1.2663, radius: 0.8247 },
  { name: 'Wheel_RL', x: 1.1002, z: -1.3491, radius: 0.8255 },
  { name: 'Wheel_RR', x: -1.0997, z: -1.3491, radius: 0.8255 },
];

export function vehicleSpec(type: VehicleType): VehicleSpec {
  return VEHICLE_SPEC[type] ?? VEHICLE_SPEC.car;
}

export function axlesFor(type: VehicleType, id = 'boy1'): Axle[] {
  if (type === 'jeep') return JEEP_AXLES;
  if (type === 'monster') return MONSTER_AXLES;
  return CAR_AXLES[id] ?? CAR_AXLES.boy1;
}

export function restLength(radius: number, drop = VEHICLE_SPEC.car.drop): number {
  return Math.max(0.16, drop - radius);
}

export const COLOR_OF: Record<string, string> = {
  boy1: 'red',
  boy2: 'blue',
  boy3: 'green',
  boy4: 'yellow',
};

export function modelFile(type: VehicleType, id: string, mobile: boolean): string {
  const color = COLOR_OF[id] ?? 'red';
  const suffix = mobile ? '_mobile' : '';
  if (type === 'car') return `cars/v3/car_${color}${suffix}.glb`;
  return `vehicles/${type}_${color}${suffix}.glb`;
}
