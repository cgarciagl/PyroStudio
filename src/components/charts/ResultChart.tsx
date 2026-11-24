import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, LineChart, PieChart } from "lucide-react";
import { EChart, axisStyle, baseOption } from "./EChart";
import { buildSeries, MAX_CHART_POINTS, numericColumns, suggestChart } from "../../utils/chartData";

type ChartKind = "bar" | "line" | "pie";

interface ResultChartProps {
  columns: string[];
  rows: unknown[][];
}

/** Quick chart for a query result: label column + up to 3 numeric measures. */
const ResultChart: React.FC<ResultChartProps> = ({ columns, rows }) => {
  const { t } = useTranslation("tableViewer");
  const suggestion = useMemo(() => suggestChart(columns, rows), [columns, rows]);
  const numeric = useMemo(() => numericColumns(columns, rows), [columns, rows]);
  const [kind, setKind] = useState<ChartKind>("bar");
  const [labelIndex, setLabelIndex] = useState(suggestion?.labelIndex ?? 0);
  const [valueIndexes, setValueIndexes] = useState<number[]>(suggestion?.valueIndexes ?? []);

  const data = useMemo(() => buildSeries(rows, labelIndex, valueIndexes), [rows, labelIndex, valueIndexes]);

  const option = useMemo(() => {
    const base = baseOption();
    if (kind === "pie") {
      const vi = valueIndexes[0];
      return {
        ...base,
        tooltip: { ...(base.tooltip as object), trigger: "item" },
        legend: { ...(base.legend as object), type: "scroll" },
        series: [
          {
            type: "pie",
            radius: ["45%", "72%"],
            top: 24,
            itemStyle: { borderColor: "transparent", borderWidth: 1 },
            label: { color: "inherit", fontSize: 11 },
            data: data.labels.map((name, i) => ({ name, value: data.series[0]?.[i] ?? 0 })),
            name: columns[vi],
          },
        ],
      };
    }
    const axis = axisStyle();
    return {
      ...base,
      tooltip: { ...(base.tooltip as object), trigger: "axis" },
      xAxis: { type: "category", data: data.labels, ...axis, splitLine: { show: false } },
      yAxis: { type: "value", ...axis },
      series: valueIndexes.map((vi, s) => ({
        name: columns[vi],
        type: kind,
        data: data.series[s],
        smooth: kind === "line",
        showSymbol: data.labels.length < 60,
        barMaxWidth: 28,
      })),
    };
  }, [kind, data, valueIndexes, columns]);

  if (!suggestion) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-fg-muted p-6 text-center">
        {t("charts.noNumericCols")}
        <code className="mx-1 font-mono">SELECT categoria, COUNT(*) … GROUP BY categoria</code>.
      </div>
    );
  }

  const toggleValue = (i: number) =>
    setValueIndexes((prev) =>
      prev.includes(i) ? (prev.length > 1 ? prev.filter((x) => x !== i) : prev) : [...prev, i].slice(-5),
    );

  const kindBtn = (k: ChartKind, Icon: React.ElementType, title: string) => (
    <button
      key={k}
      title={title}
      onClick={() => setKind(k)}
      className={`p-1.5 rounded-md transition-colors ${kind === k ? "bg-hover text-fg" : "text-fg-muted hover:text-fg hover:bg-hover"}`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-3 py-1.5 flex flex-wrap items-center gap-3 text-[11px] text-fg-muted border-b border-line">
        <div className="flex items-center">
          {kindBtn("bar", BarChart3, t("charts.bars"))}
          {kindBtn("line", LineChart, t("charts.lines"))}
          {kindBtn("pie", PieChart, t("charts.pie"))}
        </div>
        <label className="flex items-center gap-1">
          {t("charts.axis")}
          <select
            value={labelIndex}
            onChange={(e) => setLabelIndex(Number(e.target.value))}
            className="bg-transparent text-fg rounded hover:bg-hover focus:outline-none"
          >
            {columns.map((c, i) => (
              <option key={c + i} value={i} className="bg-raised">
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1">
          {t("charts.values")}
          {numeric
            .filter((i) => i !== labelIndex)
            .map((i) => (
              <button
                key={i}
                onClick={() => toggleValue(i)}
                className={`px-1.5 py-0.5 rounded font-mono ${
                  valueIndexes.includes(i) ? "bg-hover text-fg" : "hover:bg-hover hover:text-fg"
                }`}
              >
                {columns[i]}
              </button>
            ))}
        </div>
        {data.truncated && <span>{t("charts.firstPoints", { count: MAX_CHART_POINTS })}</span>}
      </div>
      <div className="flex-1 min-h-0 p-3">
        <EChart option={option} />
      </div>
    </div>
  );
};

export default ResultChart;
