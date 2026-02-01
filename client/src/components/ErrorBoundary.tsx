import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error!} resetError={this.resetError} />;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-red-50">
          <div className="text-center max-w-2xl bg-white rounded-lg shadow-lg p-6">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2 text-red-800">Application Error</h2>
            <div className="bg-red-100 border border-red-300 rounded p-3 mb-4 text-left">
              <p className="font-mono text-sm text-red-800 break-all">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
              {this.state.error?.stack && (
                <pre className="mt-2 text-xs text-red-600 overflow-auto max-h-40 whitespace-pre-wrap">
                  {this.state.error.stack}
                </pre>
              )}
            </div>
            <Button onClick={() => window.location.reload()}>
              Reload Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function InvoiceErrorFallback({ error, resetError }: { error: Error; resetError: () => void }) {
  return (
    <div className="p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive mb-4" />
      <h3 className="text-lg font-semibold mb-2">Invoice Form Error</h3>
      <p className="text-sm text-muted-foreground mb-4">
        {error.message || "Failed to load invoice form"}
      </p>
      <Button onClick={resetError} size="sm">
        Reload Form
      </Button>
    </div>
  );
}