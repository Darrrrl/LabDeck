// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });
function renderApp(fetchImplementation: typeof fetch) {
  vi.stubGlobal('fetch', fetchImplementation);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

describe('LabDeck shell', () => {
  it('shows an accessible login form for an unauthenticated owner', async () => {
    renderApp(vi.fn(() => Promise.resolve(new Response(JSON.stringify({ authenticated: false, csrfToken: 'csrf-token-which-is-long-enough', demoMode: false }), { status: 200 }))));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Owner password')).toHaveFocus();
  });

  it('shows only real navigation and the explicit empty state', async () => {
    const mockFetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/session')) return Promise.resolve(new Response(JSON.stringify({ authenticated: true, csrfToken: 'csrf-token-which-is-long-enough', demoMode: false }), { status: 200 }));
      if (url.endsWith('/settings')) return Promise.resolve(new Response(JSON.stringify({ integrations: [], authentication: 'configured', demoMode: false, version: '0.1.0' }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ overall: 'monitoring-incomplete', title: 'No integrations configured', message: 'Configure a supported integration to begin monitoring.' }), { status: 200 }));
    });
    renderApp(mockFetch);
    expect(await screen.findByRole('heading', { name: 'No integrations configured' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toHaveTextContent('OverviewSettings');
    expect(screen.queryByText('Media')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
  });
});
