import { Download, Users } from "lucide-react";
import { Button } from "../ui/button";
import type { AppId } from "../lib/api";

interface ProviderEmptyStateProps {
  appId: AppId;
  onCreate?: () => void;
  onImport?: () => void;
}

export function ProviderEmptyState({
  appId,
  onCreate,
  onImport,
}: ProviderEmptyStateProps) {
  const showSnippetHint =
    appId === "claude" || appId === "codex" || appId === "gemini";

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Users className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">No providers configured</h3>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        Add a provider to get started. Each provider can be configured with a
        custom API endpoint and key.
      </p>
      {showSnippetHint && (
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          You can also import your current configuration from an existing setup.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-2">
        {onImport && (
          <Button onClick={onImport}>
            <Download className="mr-2 h-4 w-4" />
            Import current config
          </Button>
        )}
        {onCreate && (
          <Button variant={onImport ? "outline" : "default"} onClick={onCreate}>
            Add provider
          </Button>
        )}
      </div>
    </div>
  );
}
