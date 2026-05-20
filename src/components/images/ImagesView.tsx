import { useCallback, useEffect, useState } from "react";
import { Layers, Play, RefreshCw } from "lucide-react";
import { api } from "@/lib/invoke";
import type { ImageSummary } from "@/lib/types";
import { useNewMachineDialog } from "@/hooks/useNewMachineDialog";

export function ImagesView({
  onViewMachines,
}: {
  onViewMachines: (reference: string) => void;
}) {
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openDialog = useNewMachineDialog((s) => s.openDialog);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listImages();
      setImages(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border bg-bg px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Images</h1>
          <p className="text-sm text-fg-muted">
            {images.length === 0
              ? "No images in use"
              : `${images.length} image${images.length === 1 ? "" : "s"} referenced by your machines`}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:bg-bg-card/70 disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="border-b border-stopped/40 bg-stopped/10 px-6 py-3 text-sm text-stopped">
          {error}
        </div>
      )}

      <div className="border-b border-border bg-bg/50 px-6 py-2 text-xs text-fg-muted">
        smolvm stores OCI layers per-machine, not in a global cache. This view groups
        machines by their source image reference.
      </div>

      <div className="flex-1 overflow-auto">
        {images.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12 text-sm text-fg-muted">
            No images yet. Create a machine with an image to populate this view.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr className="border-b border-border">
                <th className="px-6 py-3 font-medium">Image</th>
                <th className="px-6 py-3 font-medium">Machines</th>
                <th className="px-6 py-3 font-medium">Running</th>
                <th className="px-6 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {images.map((img) => (
                <tr key={img.reference} className="border-b border-border/60 hover:bg-bg-card/40">
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Layers className="h-4 w-4 text-accent" />
                      {img.reference}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-fg-muted">
                    {img.machines.join(", ")}
                  </td>
                  <td className="px-6 py-3 font-mono text-xs">
                    <span className={img.running_count > 0 ? "text-running" : "text-fg-muted"}>
                      {img.running_count} / {img.machines.length}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => onViewMachines(img.reference)}
                        className="rounded-md border border-border bg-bg-card px-2 py-1 text-xs hover:bg-bg-card/70"
                      >
                        View machines
                      </button>
                      <button
                        onClick={() => openDialog(img.reference)}
                        className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:bg-accent/90"
                      >
                        <Play className="h-3.5 w-3.5" />
                        New machine
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
