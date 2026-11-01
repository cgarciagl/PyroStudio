import React, { useMemo } from "react";

interface SparklineProps {
  data: number[];
  height?: number;
  width?: number;
  min?: number;
  max?: number;
  strokeColor?: string;
  fillColor?: string;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  height = 32,
  width = 120,
  min,
  max,
  strokeColor = "var(--accent, #f97316)",
  fillColor = "rgba(249, 115, 22, 0.12)",
  className = "",
}) => {
  const { pathD, areaD } = useMemo(() => {
    if (!data || data.length === 0) {
      return { pathD: `M 0 ${height / 2} L ${width} ${height / 2}`, areaD: "" };
    }

    if (data.length === 1) {
      return {
        pathD: `M 0 ${height / 2} L ${width} ${height / 2}`,
        areaD: `M 0 ${height / 2} L ${width} ${height / 2} L ${width} ${height} L 0 ${height} Z`,
      };
    }

    const padTop = 3;
    const padBottom = 3;
    const effH = Math.max(1, height - padTop - padBottom);

    const minV = min !== undefined ? min : Math.min(...data);
    const maxV = max !== undefined ? Math.max(max, ...data) : Math.max(...data);
    const range = maxV === minV ? 1 : maxV - minV;

    const points = data.map((val, idx) => {
      const x = Math.round((idx / (data.length - 1)) * width * 10) / 10;
      const normalized = Math.max(0, Math.min(1, (val - minV) / range));
      const y = Math.round((height - padBottom - normalized * effH) * 10) / 10;
      return { x, y };
    });

    const pathD = points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, "");

    const last = points[points.length - 1];
    const first = points[0];
    const areaD = `${pathD} L ${last.x} ${height} L ${first.x} ${height} Z`;

    return { pathD, areaD };
  }, [data, height, width, min, max]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`overflow-visible shrink-0 ${className}`}
      style={{ width: "100%", height, maxWidth: width }}
      preserveAspectRatio="none"
    >
      {fillColor && areaD && <path d={areaD} fill={fillColor} />}
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
