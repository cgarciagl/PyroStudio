import type { ExportProgressEvent } from "../types/database";
import { useTauriEvent } from "./useTauriEvent";

/** Progress of the streamed Excel/CSV export (table viewer and query editor). */
export const useExportProgress = () => useTauriEvent<ExportProgressEvent>("excel-export-progress");
