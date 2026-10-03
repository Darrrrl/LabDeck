import { Children, isValidElement, type ReactNode } from 'react';
import { usePreferences } from '../app/preferences.js';
import { useQuery } from '@tanstack/react-query';
import { getStorage } from '../app/api.js';
import type { StorageResponse } from '@labdeck/contracts';

export function OrderedWidgets({ children, className }: { children: ReactNode; className: string }) {
  const [preferences] = usePreferences();
  const order = (child: ReactNode) => isValidElement<{ 'data-widget'?: string }>(child) ? preferences.widgetOrder.findIndex((id) => id === child.props['data-widget']) : -1;
  return <div className={className}>{Children.toArray(children).sort((a, b) => order(a) - order(b))}</div>;
}
export function useSelectedStorage(fallback: StorageResponse['filesystems'][number] | null | undefined) {
  const [preferences] = usePreferences();
  const query = useQuery({ queryKey: ['storage', '1h'], queryFn: () => getStorage('1h'), enabled: !!preferences.selectedVolume, refetchInterval: 15_000 });
  return { storage: query.data?.filesystems.find((fs) => fs.id === preferences.selectedVolume) ?? fallback,
    freshness: preferences.selectedVolume ? query.data?.freshness : undefined,
    observedAt: preferences.selectedVolume ? query.data?.observedAt : undefined, failed: !!preferences.selectedVolume && query.isError };
}
