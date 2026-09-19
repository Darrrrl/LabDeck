import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App.js';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
