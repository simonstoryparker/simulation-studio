import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./style.css";
const report = (message: string) =>
  void invoke("report_frontend_error", { message }).catch(console.error);
window.addEventListener("error", (event) =>
  report(event.error?.stack ?? event.message),
);
window.addEventListener("unhandledrejection", (event) =>
  report(String(event.reason)),
);
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    report(error.stack + "\n" + info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <div className="empty">
          <h2>Unable to render the workspace</h2>
          <p>{this.state.error}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
