import React, { useMemo } from 'react';

export interface SparkSeries {
  label: string;
  color: string;
  data: number[];
}

interface Props {
  series: SparkSeries[];
  width?: number;
  height?: number;
  className?: string;
}

export const Sparkline: React.FC<Props> = ({
  series,
  width = 320,
  height = 80,
  className,
}) => {
  const paths = useMemo(() => {
    return series.map((s) => {
      const data = s.data;
      if (data.length < 2) return { d: '', color: s.color, label: s.label };
      const max = Math.max(...data, 1e-9);
      const min = Math.min(...data, 0);
      const range = max - min || 1;
      const step = width / (data.length - 1);
      const d = data
        .map((v, i) => {
          const x = i * step;
          const y = height - ((v - min) / range) * height;
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
      return { d, color: s.color, label: s.label };
    });
  }, [series, width, height]);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
    >
      {paths.map((p, i) => (
        <path key={`series-${i}`} d={p.d} fill="none" stroke={p.color} strokeWidth={1.5} />
      ))}
    </svg>
  );
};
