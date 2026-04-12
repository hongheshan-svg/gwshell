import { CSS } from "@dnd-kit/utilities";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AiProvider, AppId } from "../lib/api";
import { providersApi } from "../lib/api";
import { useDragSort } from "../hooks/useDragSort";
import { ProviderCard } from "./ProviderCard";
import { ProviderEmptyState } from "./ProviderEmptyState";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface ProviderListProps {
  providers: AiProvider[];
  currentProviderId: string;
  appId: AppId;
  onSwitch: (provider: AiProvider) => void;
  onEdit: (provider: AiProvider) => void;
  onDelete: (provider: AiProvider) => void;
  onRemoveFromConfig?: (provider: AiProvider) => void;
  onDuplicate: (provider: AiProvider) => void;
  onConfigureUsage?: (provider: AiProvider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: AiProvider) => void;
  onTest?: (provider: AiProvider) => void;
  onCreate?: () => void;
  isLoading?: boolean;
  isProxyRunning?: boolean;
  isProxyTakeover?: boolean;
  activeProviderId?: string;
}

export function ProviderList({
  providers,
  currentProviderId,
  appId,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onTest,
  onCreate,
  isLoading = false,
  isProxyRunning = false,
  isProxyTakeover = false,
  activeProviderId: _activeProviderId,
}: ProviderListProps) {
  const { sortedProviders, sensors, handleDragEnd } = useDragSort(
    providers,
    appId,
  );

  // For additive-mode apps (OpenCode / OpenClaw), treat every provider as "in config"
  // since GWShell doesn't have a separate live-config concept yet
  const isProviderInConfig = useCallback(
    (_providerId: string): boolean => {
      return true;
    },
    [],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Import current live config as default provider
  const queryClient = useQueryClient();
  const importMutation = useMutation({
    mutationFn: async (): Promise<AiProvider[]> => {
      return providersApi.importFromCcSwitch();
    },
    onSuccess: (imported) => {
      if (imported.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["providers", appId] });
        toast.success("Providers imported successfully");
      } else {
        toast.info("No providers found to import");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (key === "escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen]);

  const filteredProviders = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return sortedProviders;
    return sortedProviders.filter((provider) => {
      const fields = [provider.name, provider.notes, provider.websiteUrl];
      return fields.some((field) =>
        field?.toString().toLowerCase().includes(keyword),
      );
    });
  }, [searchTerm, sortedProviders]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="w-full border border-dashed rounded-lg h-28 border-muted-foreground/40 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (sortedProviders.length === 0) {
    return (
      <ProviderEmptyState
        appId={appId}
        onCreate={onCreate}
        onImport={() => importMutation.mutate()}
      />
    );
  }

  const renderProviderList = () => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={filteredProviders.map((provider) => provider.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {filteredProviders.map((provider) => (
            <SortableProviderCard
              key={provider.id}
              provider={provider}
              isCurrent={provider.id === currentProviderId}
              appId={appId}
              isInConfig={isProviderInConfig(provider.id)}
              onSwitch={onSwitch}
              onEdit={onEdit}
              onDelete={onDelete}
              onRemoveFromConfig={onRemoveFromConfig}
              onDuplicate={onDuplicate}
              onConfigureUsage={onConfigureUsage}
              onOpenWebsite={onOpenWebsite}
              onOpenTerminal={onOpenTerminal}
              onTest={onTest}
              isProxyRunning={isProxyRunning}
              isProxyTakeover={isProxyTakeover}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );

  return (
    <div className="mt-4 space-y-4">
      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            key="provider-search"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed left-1/2 top-[6.5rem] z-40 w-[min(90vw,26rem)] -translate-x-1/2 sm:right-6 sm:left-auto sm:translate-x-0"
          >
            <div className="p-4 space-y-3 border shadow-md rounded-2xl border-white/10 bg-background/95 shadow-black/20 backdrop-blur-md">
              <div className="relative flex items-center gap-2">
                <Search className="absolute w-4 h-4 -translate-y-1/2 pointer-events-none left-3 top-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search name, notes, or URL..."
                  aria-label="Search providers"
                  className="pr-16 pl-9"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute text-xs -translate-y-1/2 right-11 top-1/2"
                    onClick={() => setSearchTerm("")}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => setIsSearchOpen(false)}
                  aria-label="Close provider search"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Matches provider name, notes, and URL.</span>
                <span>Press Esc to close</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {filteredProviders.length === 0 ? (
        <div className="px-6 py-8 text-sm text-center border border-dashed rounded-lg border-border text-muted-foreground">
          No providers match your search.
        </div>
      ) : (
        renderProviderList()
      )}
    </div>
  );
}

// ─── Sortable wrapper ────────────────────────────────────────────────────────

interface SortableProviderCardProps {
  provider: AiProvider;
  isCurrent: boolean;
  appId: AppId;
  isInConfig: boolean;
  onSwitch: (provider: AiProvider) => void;
  onEdit: (provider: AiProvider) => void;
  onDelete: (provider: AiProvider) => void;
  onRemoveFromConfig?: (provider: AiProvider) => void;
  onDuplicate: (provider: AiProvider) => void;
  onConfigureUsage?: (provider: AiProvider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: AiProvider) => void;
  onTest?: (provider: AiProvider) => void;
  isProxyRunning: boolean;
  isProxyTakeover: boolean;
}

function SortableProviderCard({
  provider,
  isCurrent,
  appId,
  isInConfig,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onTest,
  isProxyRunning,
  isProxyTakeover,
}: SortableProviderCardProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ProviderCard
        provider={provider}
        isCurrent={isCurrent}
        appId={appId}
        isInConfig={isInConfig}
        onSwitch={onSwitch}
        onEdit={onEdit}
        onDelete={onDelete}
        onRemoveFromConfig={onRemoveFromConfig}
        onDuplicate={onDuplicate}
        onConfigureUsage={
          onConfigureUsage ? (item) => onConfigureUsage(item) : () => undefined
        }
        onOpenWebsite={onOpenWebsite}
        onOpenTerminal={onOpenTerminal}
        onTest={onTest}
        isProxyRunning={isProxyRunning}
        isProxyTakeover={isProxyTakeover}
        dragHandleProps={{
          attributes,
          listeners,
          isDragging,
        }}
      />
    </div>
  );
}
