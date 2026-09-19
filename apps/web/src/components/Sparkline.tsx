export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="sparkline-empty">Not enough history yet</div>;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${34 - ((value - minimum) / span) * 30}`).join(' ');
  return <svg className="sparkline" viewBox="0 0 100 38" role="img" aria-label={label} preserveAspectRatio="none"><polyline points={points} /></svg>;
}
