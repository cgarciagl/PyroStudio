import React from "react";
import {
  X,
  FileSpreadsheet,
  Check,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import type {
  ColumnMetadata,
} from "../types/database";
import { iconBtn, modalHeader, modalTitle } from "./ui/styles";

import { useImportWizard } from "./excelImport/useImportWizard";
import { StepFile } from "./excelImport/StepFile";
import { StepTarget } from "./excelImport/StepTarget";
import { StepMapping } from "./excelImport/StepMapping";
import { StepMode } from "./excelImport/StepMode";
import { StepExecution } from "./excelImport/StepExecution";

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: string;
  table?: string;
  dbColumns?: ColumnMetadata[];
  onImportComplete?: () => void;
}


export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  isOpen,
  onClose,
  database,
  table: initialTable,
  dbColumns: initialDbColumns,
  onImportComplete,
}) => {
  const wizard = useImportWizard({ isOpen, database, initialTable, initialDbColumns, onImportComplete });
  const { currentStep, setCurrentStep, previewData, isLoadingPreview, targetType, newTableName, isExecuting, executionSummary, handleProceedToStep3, resetState } = wizard;

  if (!isOpen) return null;

  const stepsList = [
    { step: 1, title: "1. Archivo y Previsualización" },
    { step: 2, title: "2. Destino y Esquema" },
    { step: 3, title: "3. Mapeo de Columnas" },
    { step: 4, title: "4. Modo de Importación" },
    { step: 5, title: "5. Ejecución" },
  ];

  return (
    <div className="pyro-operation-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-150">
      <div className="pyro-operation-modal w-full max-w-4xl bg-surface border border-line rounded-xl shadow-modal overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className={modalHeader}>
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-raised hover:bg-hover border border-accent/30 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-fg-muted" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className={modalTitle}>
                  Importar datos (Excel, CSV o JSON)
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded bg-accent-soft text-accent-text font-mono border border-accent/30">
                  {database}
                </span>
              </div>
              <p className="text-xs text-fg-muted">
                Opciones avanzadas de importación (Nueva tabla o tabla existente)
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              resetState();
              onClose();
            }}
            className={iconBtn}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper Wizard Indicator */}
        <div className="px-6 py-3 bg-surface border-b border-line flex items-center justify-between text-xs select-none overflow-x-auto">
          {stepsList.map((item) => {
            const isActive = currentStep === item.step;
            const isCompleted = currentStep > item.step;

            return (
              <div
                key={item.step}
                className={`flex items-center space-x-2 font-medium shrink-0 ${
                  isActive
                    ? "text-accent-text font-bold"
                    : isCompleted
                    ? "text-success"
                    : "text-fg-subtle"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${
                    isActive
                      ? "bg-accent text-black font-bold shadow-sm"
                      : isCompleted
                      ? "text-success border border-line"
                      : "bg-raised text-fg-subtle border border-line"
                  }`}
                >
                  {isCompleted ? <Check className="w-3 h-3" /> : item.step}
                </div>
                <span className="hidden sm:inline">{item.title}</span>
              </div>
            );
          })}
        </div>

        {/* Step Body Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-canvas">
          {/* STEP 1: FILE & PREVIEW */}
          {currentStep === 1 && <StepFile filePath={wizard.filePath} setFilePath={wizard.setFilePath} selectedSheet={wizard.selectedSheet} setSelectedSheet={wizard.setSelectedSheet} previewData={wizard.previewData} isLoadingPreview={wizard.isLoadingPreview} previewError={wizard.previewError} isDraggingFile={wizard.isDraggingFile} handleDragOver={wizard.handleDragOver} handleDragLeave={wizard.handleDragLeave} handleDrop={wizard.handleDrop} handlePickFile={wizard.handlePickFile} loadPreview={wizard.loadPreview} />}

          {/* STEP 2: DESTINATION (EXISTING TABLE VS NEW TABLE) */}
          {currentStep === 2 && <StepTarget targetType={wizard.targetType} setTargetType={wizard.setTargetType} existingTables={wizard.existingTables} selectedExistingTable={wizard.selectedExistingTable} setSelectedExistingTable={wizard.setSelectedExistingTable} targetColumns={wizard.targetColumns} isLoadingExistingCols={wizard.isLoadingExistingCols} newTableName={wizard.newTableName} setNewTableName={wizard.setNewTableName} newTableEngine={wizard.newTableEngine} setNewTableEngine={wizard.setNewTableEngine} newTableCollation={wizard.newTableCollation} setNewTableCollation={wizard.setNewTableCollation} newTableColumns={wizard.newTableColumns} setNewTableColumns={wizard.setNewTableColumns} generatedIdName={wizard.generatedIdName} handleToggleAutoAddIdPk={wizard.handleToggleAutoAddIdPk} database={database} />}

          {/* STEP 3: COLUMN MAPPING */}
          {currentStep === 3 && <StepMapping targetType={wizard.targetType} selectedExistingTable={wizard.selectedExistingTable} targetColumns={wizard.targetColumns} newTableName={wizard.newTableName} newTableColumns={wizard.newTableColumns} mappings={wizard.mappings} setMappings={wizard.setMappings} />}

          {/* STEP 4: IMPORT MODE (6 MODES) */}
          {currentStep === 4 && <StepMode setCurrentStep={wizard.setCurrentStep} mappings={wizard.mappings} importMode={wizard.importMode} setImportMode={wizard.setImportMode} batchSize={wizard.batchSize} setBatchSize={wizard.setBatchSize} errorStrategy={wizard.errorStrategy} setErrorStrategy={wizard.setErrorStrategy} dryRun={wizard.dryRun} setDryRun={wizard.setDryRun} />}

          {/* STEP 5: EXECUTION & SUMMARY */}
          {currentStep === 5 && <StepExecution previewData={wizard.previewData} targetType={wizard.targetType} selectedExistingTable={wizard.selectedExistingTable} newTableName={wizard.newTableName} importMode={wizard.importMode} batchSize={wizard.batchSize} dryRun={wizard.dryRun} isExecuting={wizard.isExecuting} progress={wizard.progress} executionSummary={wizard.executionSummary} executionError={wizard.executionError} handleExecuteImport={wizard.handleExecuteImport} />}
        </div>

        {/* Modal Navigation Footer */}
        <div className="px-6 py-4 bg-raised border-t border-line flex items-center justify-between text-xs">
          <div>
            {currentStep > 1 && !isExecuting && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => (prev - 1) as any)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-lg bg-elevated hover:bg-hover text-fg font-medium transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Anterior</span>
              </button>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {currentStep < 5 && (
              <button
                type="button"
                disabled={
                  (currentStep === 1 && (!previewData || isLoadingPreview)) ||
                  (currentStep === 2 &&
                    targetType === "new" &&
                    !newTableName.trim())
                }
                onClick={() => {
                  if (currentStep === 2) {
                    handleProceedToStep3();
                  } else {
                    setCurrentStep((prev) => (prev + 1) as any);
                  }
                }}
                className="flex items-center space-x-1.5 px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-semibold shadow-sm transition-colors disabled:opacity-40"
              >
                <span>Siguiente</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 5 && executionSummary && (
              <button
                type="button"
                onClick={() => {
                  resetState();
                  onClose();
                }}
                className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-semibold transition-colors"
              >
                Finalizar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
