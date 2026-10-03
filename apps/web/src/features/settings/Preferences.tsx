import { usePreferences, defaultPreferences } from '../../app/preferences.js';

export function Preferences() {
  const [preferences, update] = usePreferences();
  function move(index: number, delta: number) {
    const order = [...preferences.widgetOrder];
    [order[index], order[index + delta]] = [order[index + delta]!, order[index]!];
    update({ widgetOrder: order });
  }
  return <section className="panel media-section preferences"><h2>Dashboard preferences</h2>
    <p>Selections and layout are saved in this browser. If browser storage is unavailable, changes last for this tab session.</p>
    <label><input type="checkbox" checked={preferences.hideWatchingTitles} onChange={(event) => update({ hideWatchingTitles: event.target.checked })} /> Hide watching titles on the wallboard</label>
    <h3>Widget order</h3><p>The order applies to Overview and Wallboard. Status and current problems remain first.</p>
    <ol className="widget-order">{preferences.widgetOrder.map((widget, index) => <li key={widget}><span>{widget}</span><div><button type="button" aria-label={`Move ${widget} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</button><button type="button" aria-label={`Move ${widget} down`} disabled={index === preferences.widgetOrder.length - 1} onClick={() => move(index, 1)}>Down</button></div></li>)}</ol>
    <button type="button" onClick={() => update(defaultPreferences)}>Reset dashboard preferences</button>
  </section>;
}
