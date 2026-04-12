import { useState, useCallback } from "react";
import { MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { AiProvider, AppId } from "../lib/api";

export function useDragSort(providers: AiProvider[], _appId: AppId) {
  const [sortedIds, setSortedIds] = useState<string[]>(() =>
    providers.map((p) => p.id),
  );

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Rebuild order whenever the upstream list changes (new providers added / removed)
  // Use a derived sorted list: apply stored order over the current providers array
  const sortedProviders = (() => {
    const map = new Map(providers.map((p) => [p.id, p]));
    // IDs that are still present, in the stored order
    const ordered = sortedIds
      .filter((id) => map.has(id))
      .map((id) => map.get(id)!);
    // Any new providers not yet in sortedIds go at the end
    const orderedSet = new Set(sortedIds);
    const appended = providers.filter((p) => !orderedSet.has(p.id));
    return [...ordered, ...appended];
  })();

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setSortedIds((ids) => {
          // Ensure all current providers are represented
          const currentIds =
            ids.length > 0 ? ids : providers.map((p) => p.id);
          const oldIndex = currentIds.indexOf(String(active.id));
          const newIndex = currentIds.indexOf(String(over.id));
          if (oldIndex === -1 || newIndex === -1) return currentIds;
          return arrayMove(currentIds, oldIndex, newIndex);
        });
      }
    },
    [providers],
  );

  return { sortedProviders, sensors, handleDragEnd };
}
