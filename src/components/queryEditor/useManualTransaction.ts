import { useEffect, useRef, useState } from "react";
import type { ManualTxStatus } from "../../types/database";
import { dbService } from "../../services/tauriDb";
import { useManualTxStore } from "../../stores/manualTxStore";
import { useUIStore } from "../../stores/uiStore";
import { errorText } from "../../utils/errors";

/**
 * Manual-commit mode of a query tab: the tab runs on a reserved connection with
 * autocommit = 0. Publishes the pending count (tab badge) and rolls back when the tab
 * closes with work pending.
 */
export function useManualTransaction(tabId: string | undefined) {
  const [txStatus, setTxStatus] = useState<ManualTxStatus | null>(null);
  const [txBusy, setTxBusy] = useState(false);
  const txActiveRef = useRef(false);
  txActiveRef.current = txStatus !== null;

  useEffect(() => {
    if (!tabId) return;
    if (txStatus) useManualTxStore.getState().setPending(tabId, txStatus.pending_statements);
    else useManualTxStore.getState().clear(tabId);
  }, [tabId, txStatus]);

  // Closing the tab (or reconnecting) rolls back whatever is still pending.
  useEffect(() => {
    return () => {
      if (tabId && txActiveRef.current) {
        void dbService.manualTxEnd(tabId).catch(() => {});
        useManualTxStore.getState().clear(tabId);
      }
    };
  }, [tabId]);

  const runTxAction = async (action: () => Promise<ManualTxStatus | null>) => {
    setTxBusy(true);
    try {
      setTxStatus(await action());
    } catch (err) {
      useUIStore.getState().showAlert({
        title: "Transacción manual",
        message: errorText(err),
        variant: "danger",
      });
    } finally {
      setTxBusy(false);
    }
  };

  const enterManualTx = () => {
    if (!tabId) return;
    void runTxAction(() => dbService.manualTxBegin(tabId));
  };

  const exitManualTx = () => {
    if (!tabId) return;
    const leave = () =>
      void runTxAction(async () => {
        await dbService.manualTxEnd(tabId);
        return null;
      });
    const pending = txStatus?.pending_statements ?? 0;
    if (pending === 0) {
      leave();
      return;
    }
    useUIStore.getState().showConfirm({
      title: "Salir de la transacción manual",
      message: `Hay ${pending} sentencia(s) sin COMMIT. Al volver a auto-commit se hará ROLLBACK.`,
      variant: "warning",
      icon: "alert",
      confirmText: "Descartar y salir",
      onConfirm: leave,
    });
  };

  /** Read inside callbacks without re-creating them on every status change. */
  return { txActiveRef, txStatus, setTxStatus, txBusy, runTxAction, enterManualTx, exitManualTx };
}
