import React, { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, TreemapChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, DatasetComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";
import { usePreferenceStore } from "../../stores/preferenceStore";

// Tree-shaken build: only the charts PyroStudio uses.
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  TreemapChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DatasetComponent,
  CanvasRenderer,
]);

/** Reads theme tokens so charts follow light/dark mode. */
export function chartColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const accent = v("--pyro-accent", "#ff5c16");
  return {
    fg: v("--pyro-fg", "#e6e9ef"),
    muted: v("--pyro-fg-muted", "#9aa3b5"),
    line: v("--pyro-line", "#262b38"),
    surface: v("--pyro-raised", "#151924"),
    accent,
    // Accent first, then calm neutrals/blues so multi-series stay readable without rainbow noise.
    palette: [accent, "#64748b", "#38bdf8", "#a3a3a3", "#f59e0b", "#14b8a6", "#94a3b8", "#fb923c"],
  };
}

/** Shared base option: muted axes, no chart junk. */
export function baseOption(): EChartsCoreOption {
  const c = chartColors();
  return {
    color: c.palette,
    textStyle: { color: c.muted, fontFamily: "inherit", fontSize: 11 },
    tooltip: {
      backgroundColor: c.surface,
      borderColor: c.line,
      textStyle: { color: c.fg, fontSize: 11 },
    },
    legend: { textStyle: { color: c.muted, fontSize: 11 }, icon: "circle", itemWidth: 8, itemHeight: 8, top: 0 },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
  };
}

export function axisStyle() {
  const c = chartColors();
  return {
    axisLine: { lineStyle: { color: c.line } },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: c.line, type: "dashed" as const } },
  };
}

interface EChartProps {
  option: EChartsCoreOption;
  className?: string;
  style?: React.CSSProperties;
}

/** Minimal ECharts host: creates the instance once, updates options, resizes with its container. */
export const EChart: React.FC<EChartProps> = ({ option, className, style }) => {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const theme = usePreferenceStore((s) => s.theme);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option, theme]);

  return <div ref={ref} className={className} style={{ width: "100%", height: "100%", ...style }} />;
};

export default EChart;
