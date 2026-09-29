/**
 * Тема студии — тёмная, контрастная, под телефон.
 *
 * Требования заказчика: чёрный фон, белый текст, яркий синий #4690FF.
 * Значения — единственное место, где живёт палитра. Тёмная схема
 * фиксирована (без light-dark пар), потому что тёмный вариант здесь
 * единственный продуктовый.
 */
import {defineTheme} from '@astryxdesign/core/theme';

export const ACCENT = '#4690FF';

export const studioTheme = defineTheme({
  name: 'studio',

  typography: {
    // Крупный базовый размер: на телефоне текст должен читаться без
    // увеличения. ratio 1.25 даёт читаемую лестницу до display-размеров.
    scale: {base: 17, ratio: 1.25},
    body: {
      family: 'Inter',
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    heading: {
      family: 'Inter',
      fallbacks:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      weights: {3: '700', 4: '700', 5: '700', 6: '700'},
    },
    code: {
      family: 'JetBrains Mono',
      fallbacks: '"SF Mono", Monaco, Consolas, monospace',
    },
  },

  motion: {fast: 140, medium: 260, slow: 520, ratio: 0.8},

  tokens: {
    // === Основное ===
    '--color-accent': ACCENT,
    '--color-accent-muted': '#4690FF33',
    '--color-neutral': '#FFFFFF1A',
    '--color-background-surface': '#0A0A0B',
    '--color-background-body': '#000000',
    '--color-overlay': '#000000E6',
    '--color-overlay-hover': '#FFFFFF14',
    '--color-overlay-pressed': '#FFFFFF24',
    '--color-background-muted': '#141416',

    // === Текст ===
    '--color-text-primary': '#FFFFFF',
    '--color-text-secondary': '#A8ADB5',
    '--color-text-disabled': '#6A6F78',
    '--color-text-accent': ACCENT,
    '--color-on-dark': '#FFFFFF',
    '--color-on-light': '#000000',
    '--color-on-accent': '#001B3D',
    '--color-on-success': '#001B0A',
    '--color-on-error': '#3D0008',
    '--color-on-warning': '#2E2000',

    // === Иконки ===
    '--color-icon-accent': ACCENT,
    '--color-icon-primary': '#FFFFFF',
    '--color-icon-secondary': '#A8ADB5',
    '--color-icon-disabled': '#6A6F78',

    // === Поверхности ===
    '--color-background-card': '#101014',
    '--color-background-popover': '#16161A',
    '--color-background-inverted': '#FFFFFF',

    // === Статусы ===
    '--color-success': '#2ECC71',
    '--color-success-muted': '#2ECC7133',
    '--color-error': '#FF4D5E',
    '--color-error-muted': '#FF4D5E33',
    '--color-warning': '#FFC63D',
    '--color-warning-muted': '#FFC63D33',

    // === Границы и тени ===
    '--color-border': '#FFFFFF1F',
    '--color-border-emphasized': '#2A2A30',
    '--color-skeleton': '#1C1C21',
    '--color-track': '#1C1C21',
    '--color-shadow': '#000000B3',
    '--color-tint-hover': 'white',

    // === Акцентная шкала (светлее синего для текста на чёрном) ===
    '--color-background-blue': '#4690FF',
    '--color-border-blue': ACCENT,
    '--color-icon-blue': ACCENT,
    '--color-text-blue': '#9CC4FF',

    '--color-background-cyan': '#22D3EE',
    '--color-border-cyan': '#0891B2',
    '--color-icon-cyan': '#22D3EE',
    '--color-text-cyan': '#67E8F9',

    '--color-background-gray': '#1F1F25',
    '--color-border-gray': '#3A3A42',
    '--color-icon-gray': '#A8ADB5',
    '--color-text-gray': '#D4D7DD',

    '--color-background-green': '#2ECC71',
    '--color-border-green': '#1E9E55',
    '--color-icon-green': '#2ECC71',
    '--color-text-green': '#7BE8AC',

    '--color-background-orange': '#FF9F45',
    '--color-border-orange': '#C86A17',
    '--color-icon-orange': '#FF9F45',
    '--color-text-orange': '#FFC48F',

    '--color-background-pink': '#F472B6',
    '--color-border-pink': '#BE3D86',
    '--color-icon-pink': '#F472B6',
    '--color-text-pink': '#FBAED3',

    '--color-background-purple': '#A78BFA',
    '--color-border-purple': '#6D4BD1',
    '--color-icon-purple': '#A78BFA',
    '--color-text-purple': '#C9B6FD',

    '--color-background-red': '#FF4D5E',
    '--color-border-red': '#C22A3A',
    '--color-icon-red': '#FF4D5E',
    '--color-text-red': '#FFA3AC',

    '--color-background-teal': '#2DD4BF',
    '--color-border-teal': '#0F8F80',
    '--color-icon-teal': '#2DD4BF',
    '--color-text-teal': '#7CE8DC',

    '--color-background-yellow': '#FFC63D',
    '--color-border-yellow': '#B98D14',
    '--color-icon-yellow': '#FFC63D',
    '--color-text-yellow': '#FFDD8F',

    // === Скругления: крупные, «приложенческие» ===
    '--radius-none': '0px',
    '--radius-inner': '0.5rem',
    '--radius-element': '0.75rem',
    '--radius-container': '1.25rem',
    '--radius-page': '1.75rem',
    '--radius-full': '9999px',

    // === Тени ===
    '--shadow-low': '0 2px 8px #00000066',
    '--shadow-med': '0 4px 16px #00000080',
    '--shadow-high': '0 12px 32px #00000099',
    '--shadow-inset-hover': 'inset 0px 0px 0px 1px #FFFFFF26',
    '--shadow-inset-selected': 'inset 0px 0px 0px 2px #4690FF66',
    '--shadow-inset-success': 'inset 0px 0px 0px 1px #2ECC7159',
    '--shadow-inset-warning': 'inset 0px 0px 0px 1px #FFC63D59',
    '--shadow-inset-error': 'inset 0px 0px 0px 1px #FF4D5E59',
  },

  components: {
    button: {
      base: {
        borderRadius: 'var(--radius-element)',
        fontWeight: '600',
      },
      'variant:primary': {
        backgroundColor: ACCENT,
        color: 'var(--color-on-accent)',
      },
      'variant:secondary': {
        backgroundColor: '#1C1C21',
        color: 'var(--color-text-primary)',
        borderColor: 'var(--color-border-emphasized)',
      },
      'variant:ghost': {
        color: 'var(--color-text-primary)',
      },
      'variant:destructive': {
        backgroundColor: 'var(--color-error)',
        color: 'var(--color-on-error)',
      },
    },

    card: {
      base: {
        borderRadius: 'var(--radius-container)',
        borderColor: 'var(--color-border)',
      },
    },

    field: {
      base: {
        borderRadius: 'var(--radius-element)',
      },
    },

    banner: {
      base: {
        borderRadius: 'var(--radius-container)',
      },
      'status:info': {
        backgroundColor: '#4690FF1F',
        '--color-text-primary': 'var(--color-text-blue)',
        '--color-text-secondary': 'var(--color-text-blue)',
      },
      'status:success': {
        backgroundColor: '#2ECC711F',
        '--color-text-primary': 'var(--color-text-green)',
        '--color-text-secondary': 'var(--color-text-green)',
      },
      'status:warning': {
        backgroundColor: '#FFC63D1F',
        '--color-text-primary': 'var(--color-text-yellow)',
        '--color-text-secondary': 'var(--color-text-yellow)',
      },
      'status:error': {
        backgroundColor: '#FF4D5E1F',
        '--color-text-primary': 'var(--color-text-red)',
        '--color-text-secondary': 'var(--color-text-red)',
      },
    },

    badge: {
      base: {
        borderRadius: 'var(--radius-full)',
        fontWeight: '600',
      },
      'variant:info': {
        backgroundColor: '#4690FF26',
        color: 'var(--color-text-blue)',
      },
      'variant:success': {
        backgroundColor: '#2ECC7126',
        color: 'var(--color-text-green)',
      },
      'variant:warning': {
        backgroundColor: '#FFC63D26',
        color: 'var(--color-text-yellow)',
      },
      'variant:error': {
        backgroundColor: '#FF4D5E26',
        color: 'var(--color-text-red)',
      },
    },
  },
});
