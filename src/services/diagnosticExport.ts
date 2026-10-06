import type {
  HealthReport,
  IndexAdvisorReport,
} from "../types/database";

/**
 * Downloads arbitrary text or JSON as a file in the browser/webview.
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string = "text/plain;charset=utf-8",
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports HealthReport to standalone interactive HTML document.
 */
export function exportHealthReportHtml(report: HealthReport) {
  const issuesHtml = report.issues
    .map((issue) => {
      const color =
        issue.severity === "Critical"
          ? "#ef4444"
          : issue.severity === "Warning"
          ? "#f59e0b"
          : "#3b82f6";
      return `
      <div style="background:#141722; border:1px solid #232838; border-left:4px solid ${color}; border-radius:8px; padding:16px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h3 style="margin:0; font-size:15px; color:#fff;">${issue.title}</h3>
          <span style="background:${color}20; color:${color}; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-transform:uppercase;">${issue.severity}</span>
        </div>
        <p style="margin:0 0 8px 0; font-size:13px; color:#9ca3af;">${issue.description}</p>
        ${
          issue.metric_name
            ? `<div style="font-size:12px; color:#d1d5db; margin-bottom:6px;"><strong>Métrica:</strong> <code>${issue.metric_name}</code> = <code>${issue.metric_value || "N/A"}</code> (Umbral: ${issue.threshold || "N/A"})</div>`
            : ""
        }
        ${
          issue.suggestion
            ? `<div style="background:#0c0e14; border:1px solid #1f2433; border-radius:6px; padding:10px; font-size:12px; color:#fb923c;"><strong>Recomendación:</strong> ${issue.suggestion}</div>`
            : ""
        }
      </div>
    `;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>PyroStudio - Informe de Salud: ${report.database_name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0a0c10; color: #e5e7eb; margin: 0; padding: 32px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { background: #11141e; border: 1px solid #1f2535; border-radius: 12px; padding: 24px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .score-badge { width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: bold; background: #1e2538; border: 3px solid ${
      report.overall_score >= 80 ? "#10b981" : report.overall_score >= 60 ? "#f59e0b" : "#ef4444"
    }; color: #fff; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .summary-card { background: #11141e; border: 1px solid #1f2535; border-radius: 8px; padding: 14px; text-align: center; }
    code { background: #1e2433; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 style="margin:0 0 6px 0; font-size:22px; color:#fff;">Informe de Salud de Base de Datos</h1>
        <div style="font-size:13px; color:#9ca3af;">Base de datos: <strong style="color:#fff;">${report.database_name}</strong> | Servidor: ${report.server_version} | Generado por PyroStudio</div>
      </div>
      <div class="score-badge">${report.overall_score}</div>
    </div>

    <div class="summary-grid">
      <div class="summary-card" style="border-top:3px solid #ef4444;">
        <div style="font-size:24px; font-weight:bold; color:#ef4444;">${report.summary.critical_count}</div>
        <div style="font-size:12px; color:#9ca3af; text-transform:uppercase;">Problemas Críticos</div>
      </div>
      <div class="summary-card" style="border-top:3px solid #f59e0b;">
        <div style="font-size:24px; font-weight:bold; color:#f59e0b;">${report.summary.warning_count}</div>
        <div style="font-size:12px; color:#9ca3af; text-transform:uppercase;">Advertencias</div>
      </div>
      <div class="summary-card" style="border-top:3px solid #3b82f6;">
        <div style="font-size:24px; font-weight:bold; color:#3b82f6;">${report.summary.info_count}</div>
        <div style="font-size:12px; color:#9ca3af; text-transform:uppercase;">Informativos</div>
      </div>
    </div>

    <h2 style="font-size:16px; margin-bottom:12px; color:#fff;">Diagnósticos Detallados</h2>
    ${issuesHtml}
  </div>
</body>
</html>`;

  downloadFile(html, `health_report_${report.database_name}_${Date.now()}.html`, "text/html");
}

/**
 * Exports IndexAdvisorReport to CSV.
 */
export function exportIndexAdvisorCsv(report: IndexAdvisorReport) {
  const headers = ["Tabla", "Recomendacion", "Razon", "Beneficio_Estimado", "Costo_Potencial", "SQL_Propuesto", "Es_Redundante"];
  const rows = report.recommendations.map((rec) => [
    `"${rec.table_name}"`,
    `"${rec.recommendation.replace(/"/g, '""')}"`,
    `"${rec.reason.replace(/"/g, '""')}"`,
    `"${rec.estimated_benefit.replace(/"/g, '""')}"`,
    `"${rec.potential_cost.replace(/"/g, '""')}"`,
    `"${rec.sql_proposal.replace(/"/g, '""')}"`,
    rec.is_redundant ? "SI" : "NO",
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  downloadFile(csv, `index_advisor_${report.database_name}_${Date.now()}.csv`, "text/csv;charset=utf-8");
}
