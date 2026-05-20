interface Props {
  points: number[];
  max?: number;
  color?: string;
  height?: number;
  className?: string;
}

/**
 * Dependency-free sparkline. Renders `points` as a polyline scaled to fit
 * a unit-height viewBox, with a soft fill under the line. `max` pins the top
 * of the axis so CPU% can stay at 100 even when values swing.
 */
export function Sparkline({
  points,
  max,
  color = "#4c7bf4",
  height = 80,
  className,
}: Props) {
  if (points.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-fg-muted ${className ?? ""}`}
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  const width = 100;
  const top = max ?? Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((v, i) => {
    const x = i * step;
    const y = 1 - Math.min(1, v / top);
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `0,1 ${line} ${width},1`;

  return (
    <svg
      viewBox={`0 0 ${width} 1`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%", display: "block" }}
    >
      <polygon points={area} fill={color} fillOpacity="0.15" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="0.015"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
