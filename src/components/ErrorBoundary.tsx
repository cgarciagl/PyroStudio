import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, XCircle, Copy, Check } from "lucide-react";
import i18n from "../i18n";
import { primaryBtn } from "./ui/styles";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  onClose?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary ha capturado un error no controlado:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const errorText = [
      `Mensaje: ${error?.message || i18n.t("modals:errorBoundary.unknownMessage")}`,
      `Nombre: ${error?.name || "Error"}`,
      `Stack: ${error?.stack || i18n.t("modals:errorBoundary.noStack")}`,
      `Component Stack: ${errorInfo?.componentStack || i18n.t("modals:errorBoundary.noComponentStack")}`,
    ].join("\n\n");

    navigator.clipboard.writeText(errorText).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    });
  };

  render() {
    if (this.state.hasError) {
      const { fallbackTitle, onClose } = this.props;
      const { error, errorInfo, copied } = this.state;

      return (
        <div className="flex-1 w-full h-full flex flex-col items-center justify-center p-8 bg-surface text-fg select-none overflow-auto">
          <div className="max-w-xl w-full bg-raised border border-line rounded-xl p-6 shadow-modal flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start space-x-3.5">
              <div className="w-10 h-10 rounded-xl border border-line flex items-center justify-center text-danger shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-fg">
                  {fallbackTitle || i18n.t("modals:errorBoundary.defaultTitle")}
                </h3>
                <p className="text-xs text-fg-muted mt-1 leading-relaxed">
                  {i18n.t("modals:errorBoundary.description")}
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-canvas border border-line rounded-xl">
                <span className="text-[11px] font-mono font-semibold text-danger block mb-1">
                  {error.name}: {error.message}
                </span>
                {error.stack && (
                  <pre className="text-[11px] font-mono text-fg-muted overflow-x-auto max-h-36 whitespace-pre-wrap leading-relaxed select-text mt-2 p-2 bg-raised rounded border border-line">
                    {error.stack}
                  </pre>
                )}
                {errorInfo?.componentStack && (
                  <details className="mt-2 text-[11px] text-fg-subtle font-mono">
                    <summary className="cursor-pointer hover:text-fg transition-colors">
                      {i18n.t("modals:errorBoundary.viewComponentTree")}
                    </summary>
                    <pre className="mt-1 p-2 bg-raised rounded border border-line text-fg-muted whitespace-pre-wrap overflow-x-auto max-h-32">
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-line/80 gap-3">
              <button
                type="button"
                onClick={this.handleCopyError}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-elevated hover:bg-hover border border-line-strong text-fg hover:text-fg text-xs font-mono transition-colors"
                title={i18n.t("modals:errorBoundary.copyTitle")}
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-success" />
                    <span className="text-success">{i18n.t("modals:errorBoundary.copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-fg-muted" />
                    <span>{i18n.t("modals:errorBoundary.copyError")}</span>
                  </>
                )}
              </button>

              <div className="flex items-center space-x-2">
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-raised hover:bg-hover text-fg text-xs font-medium transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{i18n.t("modals:errorBoundary.closeTab")}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={this.handleReset}
                  className={primaryBtn}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{i18n.t("modals:errorBoundary.retry")}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
