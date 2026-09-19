import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from 'lucide-react';

export type StatusTone = 'healthy' | 'warning' | 'critical' | 'unknown';
const icons = { healthy: CircleCheck, warning: TriangleAlert, critical: CircleAlert, unknown: CircleHelp };

export function Status({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const Icon = icons[tone];
  return <span className={`status status--${tone}`}><Icon aria-hidden="true" size={14} />{children}</span>;
}
