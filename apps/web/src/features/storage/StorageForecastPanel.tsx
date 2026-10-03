import type { StorageForecast } from '@labdeck/contracts';
import { bytes, relativeTime } from '../../components/format.js';

export function StorageForecastPanel({ forecast }: { forecast: StorageForecast | undefined }) {
  const messages = { insufficient: 'Not enough observed history for a reliable estimate.', stale: 'No current estimate: storage evidence is stale.', nonpositive: 'No growing storage trend in the observed window.', unstable: 'Growth varies too much for a reliable estimate.', 'beyond-horizon': 'Low-space threshold is beyond the 180-day forecast horizon.', 'below-threshold': 'Available space is already at or below the low-space threshold.', estimated: '' };
  return <section className="forecast"><h3>Storage growth forecast</h3>
    {!forecast ? <p>Forecast history is not available yet.</p> : <>
      <p>{forecast.status === 'estimated' && forecast.estimatedAt ? <>Estimated low space around <strong>{new Date(forecast.estimatedAt).toLocaleDateString()}</strong>.</> : messages[forecast.status]}</p>
      <p>Low space means {bytes(forecast.thresholdBytes)} available (10% of capacity). Observed {relativeTime(forecast.observedAt)}.</p>
      {forecast.growthBytesPerDay !== null ? <p>Recent net growth: {forecast.growthBytesPerDay < 0 ? '−' : ''}{bytes(Math.abs(forecast.growthBytesPerDay))}/day.</p> : null}
      {forecast.earliestAt && forecast.latestAt ? <p>Plausible range: {new Date(forecast.earliestAt).toLocaleDateString()} – {new Date(forecast.latestAt).toLocaleDateString()}. This range describes variation in recent growth, not a statistical confidence interval.</p> : null}
      <p className="fine-print">{forecast.validDays} valid days · {Math.round(forecast.coverage * 100)}% day coverage · {new Date(forecast.windowStart).toLocaleDateString()} – {new Date(forecast.windowEnd).toLocaleDateString()}. A valid day has observations in at least 18 distinct hours. Estimates require at least 14 valid days and 70% of the 30-day window; identity or capacity changes restart history.</p>
    </>}
  </section>;
}
