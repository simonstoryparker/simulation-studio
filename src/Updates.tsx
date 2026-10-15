import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Status = {
  phase: string;
  version?: string;
  downloaded: number;
  total?: number;
  message?: string;
};
export function Updates({
  connected,
  save,
}: {
  connected: boolean;
  save: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status>({
    phase: "checking",
    downloaded: 0,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const stop = await listen<Status>("update-status", (event) =>
        setStatus(event.payload),
      );
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      const initial = await invoke<Status>("update_status");
      if (!cancelled) setStatus(initial);
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  const restart = async () => {
    setBusy(true);
    setError("");
    let prepared = false;
    try {
      await invoke("prepare_update");
      prepared = true;
      await save();
      await invoke("install_update");
    } catch (e) {
      if (prepared) await invoke("cancel_update");
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const labels: Record<string, string> = {
    checking: "Checking for updates…",
    current: "Studio is up to date.",
    downloading: `Downloading ${status.version ?? "update"}…`,
    ready: `Version ${status.version ?? ""} is ready to install.`,
    installing: "Installing update…",
    error: "Could not check for updates.",
    unavailable: "Updates unavailable in this build.",
  };
  return (
    <section className="settings-card">
      <h2>App updates</h2>
      <p>Simulation Studio {__APP_VERSION__}</p>
      <p role="status">
        {labels[status.phase] ?? "Updates check automatically."}
      </p>
      {status.phase === "downloading" && (
        <progress
          value={status.total ? status.downloaded : undefined}
          max={status.total}
        />
      )}
      {status.message && <p>{status.message}</p>}
      {error && <p role="alert">{error}</p>}
      {status.phase === "ready" && (
        <>
          <button disabled={connected || busy} onClick={() => void restart()}>
            Restart to update
          </button>
          {connected && <p>Stop the simulation before restarting Studio.</p>}
        </>
      )}
      <button
        disabled={
          busy ||
          ["checking", "downloading", "installing"].includes(status.phase)
        }
        onClick={() => {
          setError("");
          void invoke("check_update").catch((e) => setError(String(e)));
        }}
      >
        Check for updates
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void invoke("open_downloads").catch((e) => setError(String(e)))
        }
      >
        Download installer
      </button>
      <p className="hint">
        Updates download automatically. Restarting replaces this installation
        and keeps your workspaces.
      </p>
    </section>
  );
}
