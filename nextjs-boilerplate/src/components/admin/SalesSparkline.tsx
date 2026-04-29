interface SalesSparklineProps {
  data: { date: string; value: number }[];
  height?: number;
  color?: string;
}

export function SalesSparkline({
  data,
  height = 80,
  color = '#6C47FF',
}: SalesSparklineProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        Žádná data
      </div>
    );
  }

  const width = 600;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data
    .map((d, i) => {
      const x = i * stepX;
      const y = height - (d.value / max) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      role="img"
      aria-label="Graf prodejů"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-20 w-full"
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#spark-fill)" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
