/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'three/webgpu' {
  import type { WebGLRendererParameters } from 'three';
  export class WebGPURenderer {
    constructor(parameters?: WebGLRendererParameters);
    init(): Promise<void>;
    domElement: HTMLCanvasElement;
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: unknown, camera: unknown): void;
    setAnimationLoop(callback: ((time: number) => void) | null): void;
    shadowMap: { enabled: boolean; type: number };
    outputColorSpace: string;
    toneMapping: number;
    toneMappingExposure: number;
    info: { render: { calls: number; triangles: number } };
    setClearColor(color: number, alpha?: number): void;
  }
}
