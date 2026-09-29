import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {QueryClientProvider} from '@tanstack/react-query';
import {Theme} from '@astryxdesign/core/theme';
import {studioTheme} from './styles/studio.js';

import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './styles/studio-theme.css';
import './styles/app.css';

import {App} from './App.tsx';
import {queryClient} from './lib/queryClient.ts';
import {registerPwa} from './lib/pwa.ts';

// Объект темы нужен провайдеру для переопределений компонентов, а
// переменные --color-* и шрифты приходят из собранного CSS. Порядок
// импортов важен: сброс → база → тема → свои стили.
const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root — проверьте index.html');

createRoot(root).render(
  <StrictMode>
    <Theme theme={studioTheme}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </Theme>
  </StrictMode>,
);

registerPwa();
