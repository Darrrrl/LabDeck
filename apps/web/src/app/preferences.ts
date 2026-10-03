import { useMemo, useSyncExternalStore } from 'react';
import { dashboardPreferencesSchema, widgetIds, type DashboardPreferences } from '@labdeck/contracts';

const key = 'labdeck.preferences.v1';
const eventName = 'labdeck-preferences';
export const defaultPreferences: DashboardPreferences = { version: 1, selectedVolume: '', historyRange: '1h', containerSearch: '', containerFilter: 'all', hideWatchingTitles: false, widgetOrder: [...widgetIds] };
let memory = '';
let memoryOnly = false;
function snapshot(): string {
  if (memoryOnly) return memory;
  try { return localStorage.getItem(key) ?? ''; } catch { return memory; }
}
export function parsePreferences(raw: string): DashboardPreferences {
  try { return dashboardPreferencesSchema.safeParse(JSON.parse(raw)).data ?? defaultPreferences; } catch { return defaultPreferences; }
}
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback); window.addEventListener(eventName, callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(eventName, callback); };
}
export function usePreferences() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => '');
  const preferences = useMemo(() => parsePreferences(raw), [raw]);
  function update(patch: Partial<DashboardPreferences>) {
    const next = dashboardPreferencesSchema.parse({ ...parsePreferences(snapshot()), ...patch });
    memory = JSON.stringify(next);
    try { localStorage.setItem(key, memory); } catch { memoryOnly = true; }
    window.dispatchEvent(new Event(eventName));
  }
  return [preferences, update] as const;
}
