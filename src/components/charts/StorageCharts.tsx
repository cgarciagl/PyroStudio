import React, { useMemo } from "react";
import { EChart, axisStyle, baseOption, chartColors } from "./EChart";

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

interface SizedTable {
  name: string;
  data_bytes: number;
  index_bytes: number;
}

/** Horizontal stacked bars: data vs index size for the heaviest tables. */
export const TopTablesChart: React.FC<{ tables: SizedTable[]; limit?: number }> = ({ tables, limit = 10 }) => {
  const option = useMemo(() => {
    const top = [...tables]
      .sort((a, b) => b.data_bytes + b.index_bytes - (a.data_bytes + a.index_bytes))
      .slice(0, limit)
      .reverse();
    const c = chartColors();
    const axis = axisStyle();
    return {
      ...baseOption(),
      color: [c.accent, "#64748b"],
      tooltip: {
        ...(baseOption().tooltip as object),
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: number) => formatBytes(v),
      },
      xAxis: { type: "value", ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => formatBytes(v) } },
      yAxis: { type: "category", data: top.map((t) => t.name), ...axis, splitLine: { show: false } },
      series: [
        { name: "Datos", type: "bar", stack: "size", data: top.map((t) => t.data_bytes), barMaxWidth: 16 },
        { name: "Índices", type: "bar", stack: "size", data: top.map((t) => t.index_bytes), barMaxWidth: 16 },
      ],
    };
  }, [tables, limit]);

  if (!tables.length) return null;
  return <EChart option={option} style={{ height: Math.max(160, Math.min(tables.length, limit) * 26 + 40) }} />;
};

/** Treemap of total size per table: where the storage goes, at a glance. */
export const TableSizeTreemap: React.FC<{ tables: SizedTable[] }> = ({ tables }) => {
  const option = useMemo(() => {
    const c = chartColors();
    return {
      ...baseOption(),
      tooltip: {
        ...(baseOption().tooltip as object),
        formatter: (p: { name: string; value: number }) => `${p.name}<br/>${formatBytes(p.value)}`,
      },
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          label: { color: "#fff", fontSize: 11, formatter: "{b}" },
          itemStyle: { borderColor: c.surface, borderWidth: 2, gapWidth: 2 },
          // Single hue, lightness by size: emphasizes weight without rainbow noise.
          visualDimension: 0,
          color: [c.accent],
          colorSaturation: [0.35, 0.75],
          data: tables
            .map((t) => ({ name: t.name, value: t.data_bytes + t.index_bytes }))
            .filter((t) => t.value > 0),
        },
      ],
    };
  }, [tables]);

  if (!tables.some((t) => t.data_bytes + t.index_bytes > 0)) return null;
  return <EChart option={option} style={{ height: 220 }} />;
};

export default TopTablesChart;
