import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, AlertTriangle, AlertCircle, X, Check } from "lucide-react";
import type { PasteValidationResult } from "../utils/pasteParser";
import { iconBtn, modalHeader, modalTitle, primaryBtn } from "./ui/styles";

interface PastePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  validation: PasteValidationResult;
  targetTableName: string;
}

export const PastePreviewModal: React.FC<PastePreviewModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  validation,
  targetTableName,
}) => {
  const { t } = useTranslation("dataGrid");

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && validation.errors.length === 0 && !e.shiftKey) {
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onConfirm, validation.errors.length]);

  if (!isOpen) return null;

  const hasErrors = validation.errors.length > 0;
  const hasPkModification = validation.pkColumnsAffected.length > 0;
  const previewSlice = validation.changes.slice(0, 50);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-2xl max-h-[85vh] rounded-xl border flex flex-col overflow-hidden animate-in zoom-in-95 duration-150 shadow-modal bg-surface border-line text-fg shadow-black/80`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          className={modalHeader}
        >
          <div className="flex items-center space-x-2.5">
            <div
              className={`p-1.5 rounded-lg border ${
                hasPkModification
                  ? "bg-raised text-warning border-line"
                  : "bg-accent-soft text-accent-text border-accent/30"
              }`}
            >
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className={modalTitle}>
                {t("pastePreview.title")}
              </h3>
              <p className={`text-[11px] font-mono text-fg-muted`}>
                {t("pastePreview.tableLabel")}<strong className="text-accent-text">{targetTableName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={iconBtn}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {/* Metrics summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className={`p-2.5 rounded-lg border flex flex-col bg-raised border-line`}
            >
              <span className="text-[11px] font-mono text-fg-muted">{t("pastePreview.totalCells")}</span>
              <span className="text-base font-semibold font-mono text-accent-text">{validation.totalCells}</span>
            </div>
            <div
              className={`p-2.5 rounded-lg border flex flex-col bg-raised border-line`}
            >
              <span className="text-[11px] font-mono text-fg-muted">{t("pastePreview.affectedRows")}</span>
              <span className="text-base font-semibold font-mono text-info">{validation.affectedRowsCount}</span>
            </div>
            <div
              className={`p-2.5 rounded-lg border flex flex-col ${
                hasPkModification
                  ? "bg-surface border-line" : "bg-raised border-line"
              }`}
            >
              <span className="text-[11px] font-mono text-fg-muted">{t("pastePreview.primaryKeys")}</span>
              <span
                className={`text-base font-semibold font-mono ${
                  hasPkModification ? "text-warning" : "text-success"
                }`}
              >
                {validation.pkColumnsAffected.length > 0
                  ? validation.pkColumnsAffected.length
                  : "0"}
              </span>
            </div>
            <div
              className={`p-2.5 rounded-lg border flex flex-col ${
                validation.warnings.length > 0
                  ? "bg-surface border-line" : "bg-raised border-line"
              }`}
            >
              <span className="text-[11px] font-mono text-fg-muted">{t("pastePreview.warnings")}</span>
              <span
                className={`text-base font-semibold font-mono ${
                  validation.warnings.length > 0 ? "text-warning" : "text-success"
                }`}
              >
                {validation.warnings.length}
              </span>
            </div>
          </div>

          {/* Blocking Errors */}
          {hasErrors && (
            <div
              className={`p-3.5 rounded-lg border space-y-1.5 bg-surface border-line text-danger`}
            >
              <div className="flex items-center space-x-2 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 text-danger shrink-0" />
                <span>{t("pastePreview.errorsTitle")}</span>
              </div>
              <ul className="text-xs list-disc list-inside space-y-0.5 opacity-90">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {validation.warnings.length > 0 && !hasErrors && (
            <div
              className={`p-3 rounded-lg border space-y-1.5 max-h-36 overflow-y-auto bg-surface border-line text-fg`}
            >
              <div className="flex items-center space-x-2 text-xs font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                <span>{t("pastePreview.warningsTitle")}</span>
              </div>
              <ul className="text-[11px] font-mono list-disc list-inside space-y-0.5 opacity-90">
                {validation.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Proposed changes sample table */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-medium text-fg-muted">
              <span>{t("pastePreview.queuedChanges")}</span>
              <span className="text-[11px] font-mono">
                {t("pastePreview.showingSlice", { shown: previewSlice.length, total: validation.changes.length })}
              </span>
            </div>

            <div
              className={`rounded-lg border overflow-hidden max-h-56 overflow-y-auto border-line bg-canvas`}
            >
              <table className="w-full text-left text-xs font-mono">
                <thead
                  className={`sticky top-0 text-[11px] border-b bg-raised text-fg-muted border-line`}
                >
                  <tr>
                    <th className="px-3 py-1.5">{t("pastePreview.colRow")}</th>
                    <th className="px-3 py-1.5">{t("pastePreview.colColumn")}</th>
                    <th className="px-3 py-1.5">{t("pastePreview.colCurrent")}</th>
                    <th className="px-3 py-1.5">{t("pastePreview.colNew")}</th>
                    <th className="px-3 py-1.5 text-right">{t("pastePreview.colType")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {previewSlice.map((ch, idx) => (
                    <tr
                      key={idx}
                      className={
                        "hover:bg-hover transition-colors"
                      }
                    >
                      <td className="px-3 py-1.5 text-fg-muted">#{ch.row + 1}</td>
                      <td className="px-3 py-1.5 font-semibold flex items-center space-x-1">
                        {ch.isPk && <span title={t("pastePreview.pkTooltip")}>🔑</span>}
                        <span>{ch.columnName}</span>
                      </td>
                      <td className="px-3 py-1.5 text-fg-muted truncate max-w-[140px]">
                        {ch.originalValue === null
                          ? "NULL"
                          : String(ch.originalValue)}
                      </td>
                      <td className="px-3 py-1.5 font-bold text-accent-text truncate max-w-[160px]">
                        {ch.proposedValue === null ? "NULL" : String(ch.proposedValue)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {ch.isPk ? (
                          <span className="px-1.5 py-0.5 rounded text-[11px] text-warning">
                            PK
                          </span>
                        ) : ch.typeWarning ? (
                          <span className="px-1.5 py-0.5 rounded text-[11px] text-danger">
                            {t("pastePreview.typeBadge")}
                          </span>
                        ) : (
                          <span className="text-[11px] text-fg-subtle">{t("pastePreview.normalBadge")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className={`px-5 py-3 border-t flex items-center justify-between shrink-0 bg-raised border-line`}
        >
          <div className="text-[11px] text-fg-muted font-mono">
            {hasErrors
              ? t("pastePreview.footerError")
              : t("pastePreview.footerReady")}
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors bg-raised hover:bg-hover border-line-strong text-fg`}
            >
              {t("pastePreview.cancel")}
            </button>
            <button
              type="button"
              disabled={hasErrors || validation.totalCells === 0}
              onClick={onConfirm}
              className={primaryBtn}
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t("pastePreview.applyChanges", { count: validation.totalCells })}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

