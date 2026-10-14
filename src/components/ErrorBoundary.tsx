import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, XCircle, Copy, Check } from "lucide-react";

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
      `Mensaje: ${error?.message || "Desconocido"}`,
      `Nombre: ${error?.name || "Error"}`,
      `Stack: ${error?.stack || "Sin stack trace"}`,
      `Component Stack: ${errorInfo?.componentStack || "Sin component stack"}`,
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
        <div className="flex-1 w-full h-full flex flex-col items-center justify-center p-8 bg-[#0d0f15] text-neutral-200 select-none overflow-auto">
          <div className="max-w-xl w-full bg-[#121622] border border-red-500/30 rounded-2xl p-6 shadow-2xl flex flex-col space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white tracking-tight">
                  {fallbackTitle || "Error al renderizar la vista"}
                </h3>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  Se ha producido una excepción inesperada durante la carga de este componente. La aplicación continúa funcionando.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-[#0a0c10] border border-red-900/40 rounded-xl">
                <span className="text-[11px] font-mono font-semibold text-red-400 block mb-1">
                  {error.name}: {error.message}
                </span>
                {error.stack && (
                  <pre className="text-[10px] font-mono text-neutral-400 overflow-x-auto max-h-36 whitespace-pre-wrap leading-relaxed select-text mt-2 p-2 bg-black/40 rounded border border-neutral-800">
                    {error.stack}
                  </pre>
                )}
                {errorInfo?.componentStack && (
                  <details className="mt-2 text-[10px] text-neutral-500 font-mono">
                    <summary className="cursor-pointer hover:text-neutral-300 transition-colors">
                      Ver árbol de componentes de React
                    </summary>
                    <pre className="mt-1 p-2 bg-black/40 rounded border border-neutral-800 text-neutral-400 whitespace-pre-wrap overflow-x-auto max-h-32">
                      {errorInfo.componentStack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80 gap-3">
              <button
                type="button"
                onClick={this.handleCopyError}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#181d2a] hover:bg-[#202738] border border-[#273146] text-neutral-300 hover:text-white text-xs font-mono transition-colors"
                title="Copiar detalles técnicos al portapapeles"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Copiar Error</span>
                  </>
                )}
              </button>

              <div className="flex items-center space-x-2">
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Cerrar Pestaña</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={this.handleReset}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-lg shadow-orange-600/20 transition-all active:scale-95"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Reintentar</span>
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
