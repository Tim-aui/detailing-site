import {useEffect} from 'react';
import liquidGL, {type LiquidGLInstance, type LiquidGLOptions} from 'liquid-gl';

/**
 * Настоящий стеклянный эффект на перечисленных элементах.
 *
 * liquid-gl сам выбирает движок: WebGPU → WebGL2 → WebGL1 →
 * обычный backdrop-filter. Отдельно проверяем «уменьшенное движение»:
 * при включённой настройке шейдер не запускаем вовсе, оставляя
 * статичное стекло — движение здесь было бы лишним.
 *
 * Эффект всегда оборачиваем в `try/catch`: библиотека падает на
 * некоторых драйверах, а интерфейс обязан работать и без стекла.
 */
export function useLiquidGlass(
  selectors: string[],
  options: Omit<LiquidGLOptions, 'target' | 'snapshot'> = {},
) {
  const key = selectors.join(',');

  useEffect(() => {
    if (typeof window === 'undefined' || key === '') return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let instance: LiquidGLInstance | null = null;
    let disposed = false;

    const dispose = () => {
      if (!instance) return;
      const lenses = Array.isArray(instance) ? instance : [instance];
      for (const lens of lenses) lens.destroy();
      instance = null;
    };

    const mount = async () => {
      if (disposed || mq.matches) return;
      // Шрифты влияют на раскладку снимка — ждём их, иначе стекло
      // «прилипает» к старым размерам текста.
      await document.fonts?.ready?.catch(() => undefined);
      if (disposed || mq.matches) return;
      dispose();
      try {
        instance = liquidGL({
          target: key,
          snapshot: 'body',
          engine: 'auto',
          resolution: Math.min(2, window.devicePixelRatio || 1),
          refraction: 0.012,
          bevelDepth: 0.14,
          bevelWidth: 0.18,
          frost: 2,
          shadow: true,
          specular: true,
          reveal: 'fade',
          tint: 'rgba(10, 12, 20, 0.28)',
          ...options,
        });
      } catch (error) {
        // Статичное стекло в CSS уже нарисовано — этого достаточно.
        console.warn('Стекло не запустилось, оставляем статичный фон:', error);
      }
    };

    // Небольшая задержка: к моменту монтирования разметка готова.
    const raf = requestAnimationFrame(() => void mount());

    const onChange = () => {
      if (mq.matches) dispose();
      else void mount();
    };
    mq.addEventListener('change', onChange);

    return () => {
      disposed = true;
      mq.removeEventListener('change', onChange);
      cancelAnimationFrame(raf);
      dispose();
    };
  }, [key]);
}
