import {Text} from '@astryxdesign/core/Text';
import {Center} from '@astryxdesign/core/Center';
import {VStack} from '@astryxdesign/core/Layout';

export function LoadingIndicator({label = 'Загружаем'}: {label?: string}) {
  return (
    <Center minHeight="40dvh" aria-busy>
      <VStack gap={3} style={{textAlign: 'center'}}>
        <span
          aria-hidden
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,0.15)',
            borderTopColor: 'var(--color-accent, #4690FF)',
            animation: 'studio-spin 700ms linear infinite',
            display: 'inline-block',
          }}
        />
        <Text type="supporting" color="secondary">
          {label}…
        </Text>
      </VStack>
      <style>{'@keyframes studio-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){@keyframes studio-spin{to{transform:none}}}'}</style>
    </Center>
  );
}
