import React, { useId, useMemo } from 'react';

export interface SparkSeries {
  label: string;
  color: string;
  data: number[];
}

interface Props {
  series: SparkSeries[];
  width?: number;
  height?: number;
  /** Optional fixed upper bound (e.g. 100 for percentage charts). */
  fixedMax?: number;
  className?: string;
}

export const Sparkline: React.FC<Props> = ({
  series,
  width = 360,
  height = 84,
  fixedMax,
  className,
}) => {
  const uid = useId().replace(/:/g, '');
  const padTop = 6;
  const padBottom = 4;
  const usableH = Math.max(10, height - padTop - padBottom);

  const computed = useMemo(() => {
    let globalMax = fixedMax ?? 0;
    if (fixedMax === undefined) {
      for (const s of series) {
        for (const v of s.data) {
          if (v > globalMax) globalMax = v;
        }
      }
      if (globalMax <= 0) globalMax = 1;
    }

    return series.map((s, idx) => {
      const data = s.data;
      const gradId = ['spGrad', uid, String(idx)].join('_');
      if (data.length < 2) {
        const emptyPoint: { x: number; y: number } | null = null;
        return {
          gradId,
          linePath: '',
          areaPath: '',
          lastPoint: emptyPoint,
          color: s.color,
          label: s.label,
        };
      }
      const step = width / (data.length - 1);
      const points = data.map((v, i) => {
        const clamped = Math.max(0, Math.min(globalMax, v));
        const x = i * step;
        const y = padTop + usableH - (clamped / globalMax) * usableH;
        return { x, y };
      });
      const linePath = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');
      const baseY = (padTop + usableH).toFixed(1);
      const firstX = points[0].x.toFixed(1);
      const lastX = points[points.length - 1].x.toFixed(1);
      const areaPath = `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
      return {
        gradId,
        linePath,
        areaPath,
        lastPoint: points[points.length - 1],
        color: s.color,
        label: s.label,
      };
    });
  }, [series, width, fixedMax, uid, usableH]);

  const gridLines = [0.25, 0.5, 0.75].map((frac) => padTop + usableH * frac);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
    >
      <defs>
        {computed.map((p) => (
          <linearGradient key={p.gradId} id={p.gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={p.color} stopOpacity="0.01" />
          </linearGradient>
        ))}
      </defs>
      {gridLines.map((y, idx) => (
        <line
          key={idx}
          x1={0}
          y1={y}
          x2={width}
          y2={y}
          className="sp-sparkline-grid"
          strokeDasharray="3 3"
        />
      ))}
      {computed.map((p) => (
        <g key={`${p.gradId}-g`}>
          {p.areaPath && <path d={p.areaPath} fill={`url(#${p.gradId})`} />}
          {p.linePath && (
            <path
              d={p.linePath}
              fill="none"
              stroke={p.color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {p.lastPoint && (
            <circle
              cx={p.lastPoint.x}
              cy={p.lastPoint.y}
              r={2.5}
              fill={p.color}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      ))}
    </svg>
  );
};
