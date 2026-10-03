// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageResponse } from '@labdeck/contracts';
import { SmartTests } from './SmartTests.js';

const disk: StorageResponse['smart']['disks'][number] = {
  id: 'disk-a', label: 'Data disk', state: 'ok', observedAt: '2026-10-01T10:00:00Z', evidenceAt: '2026-10-01T10:00:00Z', temperatureWarning: false,
  identity: 'a'.repeat(32), serialSuffix: '1234', protocol: 'ATA', model: 'Example', capacityBytes: 1000, temperatureCelsius: 35,
  health: 'passed', powerOnHours: 100, selfTest: { state: 'idle', remainingPercent: null, shortMinutes: 2, extendedMinutes: 180, history: [] },
  ata: { reallocated: '0', pending: '0', uncorrectable: '0' }, nvme: null, scsi: null
};

afterEach(() => vi.unstubAllGlobals());
describe('SMART test controls', () => {
  it('sends only the selected ID and fixed test type, then reports acceptance separately from results', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/session')) return Promise.resolve(new Response(JSON.stringify({ authenticated: true, csrfToken: 'csrf-token-which-is-long-enough', demoMode: false }), { status: 200 }));
      expect(typeof init?.body).toBe('string');
      expect(JSON.parse(init?.body as string)).toEqual({ diskId: 'disk-a', type: 'extended' });
      expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-token-which-is-long-enough');
      return Promise.resolve(new Response(JSON.stringify({ status: 'started' }), { status: 202 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SmartTests disk={disk} controlAvailable canStart />);
    await userEvent.click(screen.getByRole('button', { name: 'Start extended test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('accepted by the host');
    expect(screen.getByRole('button', { name: 'Start extended test' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
