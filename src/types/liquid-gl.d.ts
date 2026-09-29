/**
 * Типы для liquid-gl.
 *
 * Пакет не поставляет .d.ts, хотя код написан на ESM и API стабильный.
 * Объявляем ровно то, чем пользуемся: функция инициализации и
 * возвращаемый «линз» с методом destroy.
 */
declare module 'liquid-gl' {
  export interface LiquidGLOptions {
    /** CSS-селектор элементов, которым нужен эффект стекла. */
    target?: string;
    /** Что снимать в текстуру: селектор или сам элемент. */
    snapshot?: string | HTMLElement;
    /** 'auto' подбирает WebGPU → WebGL2 → WebGL1 → backdrop-filter. */
    engine?: string;
    /** Множитель плотности текстуры. */
    resolution?: number;
    zIndex?: number;
    content?: string;
    refraction?: number;
    aberration?: number;
    bevelDepth?: number;
    bevelWidth?: number;
    frost?: number;
    shadow?: boolean;
    specular?: boolean;
    reveal?: string;
    tilt?: boolean;
    tiltFactor?: number;
    tiltEase?: number;
    draggable?: boolean;
    interaction?: string;
    interactionStrength?: number;
    interactionRadius?: number;
    interactionViscosity?: number;
    magnify?: number;
    /** Любой CSS-цвет полупрозрачного тонирования. */
    tint?: string | null;
    helper?: boolean;
    on?: Record<string, (event: unknown) => void>;
  }

  export interface LiquidGLLens {
    /** Снимает текстуру, canvas и слушатели. */
    destroy(): void;
    element?: HTMLElement;
  }

  export type LiquidGLInstance = LiquidGLLens | LiquidGLLens[];

  const liquidGL: (options?: LiquidGLOptions) => LiquidGLInstance;
  export default liquidGL;
}
