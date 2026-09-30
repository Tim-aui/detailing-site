import type {CSSProperties} from 'react';
import {Text} from '@astryxdesign/core/Text';

/**
 * Крутящийся кружок + подпись, всегда строго по центру.
 *
 *   <LoadingIndicator />             — по центру блока (список, слоты)
 *   <LoadingIndicator fullscreen />  — по центру экрана (загрузка страницы)
 */
export function LoadingIndicator({label = 'Загружаем', fullscreen = false}: {label?: string; fullscreen?: boolean}) {
  const box: CSSProperties = fullscreen
    ? {position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'none'}
    : {width: '100%', minHeight: 160, padding: '32px 0'};
  return (
    <div
      role="status"
      aria-busy
      style={{
        ...box,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 34,
          height: 34,
          flex: 'none',
          boxSizing: 'border-box',
          borderRadius: '50%',
          border: '3px solid rgba(255,255,255,0.15)',
          borderTopColor: 'var(--color-accent, #4690FF)',
          animation: 'studio-spin 700ms linear infinite',
        }}
      />
      <Text type="supporting" color="secondary">
        {label}…
      </Text>
      <style>{'@keyframes studio-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){@keyframes studio-spin{to{transform:none}}}'}</style>
    </div>
  );
}
