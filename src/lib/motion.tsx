import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';

/** Уважает системную настройку «уменьшить движение». */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

type RevealProps = {
  children: ReactNode;
  /** Порог появления: доля элемента, видимая перед срабатыванием. */
  threshold?: number;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
  style?: CSSProperties;
};

/**
 * Плавное появление раздела при прокрутке.
 *
 * Используется IntersectionObserver, а не scroll-слушатель: он не
 * вызывает перестроение layout на каждом кадре. Если анимации в системе
 * выключены, раздел просто виден сразу.
 */
export function Reveal({children, threshold = 0.12, className, style, as: Tag = 'div'}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (reduced) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      {threshold, rootMargin: '0px 0px -8% 0px'},
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, threshold]);

  return (
    <Tag
      ref={ref as never}
      style={style}
      className={['reveal', visible ? 'is-visible' : '', className ?? ''].filter(Boolean).join(' ')}
    >
      {children}
    </Tag>
  );
}

/**
 * Лёгкий параллакс главного фото. Отключается при «уменьшенном
 * движении» — там статичная картинка.
 */
export function useParallax<T extends HTMLElement = HTMLDivElement>(strength = 0.18) {
  const ref = useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el: T | null = ref.current;
    if (!el || reduced) return;
    let frame = 0;
    let last = -1;

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (y === last) return;
        last = y;
        // Двигаем фото медленнее страницы: создаёт глубину,
        // но не отрывает его от содержимого над ним.
        const offset = y * strength;
        el.style.transform = `translate3d(0, ${offset}px, 0)`;
      });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, {passive: true});
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced, strength]);

  return ref;
}
