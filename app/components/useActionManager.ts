"use client";

import { useCallback, useState } from "react";
import type { Action, ActionInsert } from "@/lib/types";

/**
 * Shared client state for Action Tracker views: the action list, the single
 * ActionModal's open/prefill/edit state, and save/delete handlers.
 * Saves come back from the API (the modal awaits them); deletes are optimistic
 * and revert on failure.
 */
export function useActionManager(initialActions: Action[]) {
  const [actions, setActions] = useState<Action[]>(initialActions);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalPrefill, setModalPrefill] = useState<Partial<ActionInsert> | undefined>();
  const [modalEditAction, setModalEditAction] = useState<Action | undefined>();
  // Bumped on every open so the modal remounts with fresh form state
  const [modalKey, setModalKey] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync when the server re-fetches (e.g. router.refresh after import)
  const [syncedInitial, setSyncedInitial] = useState(initialActions);
  if (initialActions !== syncedInitial) {
    setSyncedInitial(initialActions);
    setActions(initialActions);
  }

  function openModal(prefill?: Partial<ActionInsert>, editAction?: Action) {
    setModalPrefill(prefill);
    setModalEditAction(editAction);
    setModalKey((k) => k + 1);
    setActionError(null);
    setIsModalOpen(true);
  }

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  function handleSave(saved: Action) {
    setActions((prev) =>
      prev.some((a) => a.id === saved.id)
        ? prev.map((a) => (a.id === saved.id ? saved : a))
        : [saved, ...prev]
    );
    setIsModalOpen(false);
  }

  async function handleDelete(action: Action) {
    setIsModalOpen(false);
    setActionError(null);

    // Optimistic remove; restore the previous list on failure
    const snapshot = actions;
    setActions((prev) => prev.filter((a) => a.id !== action.id));

    try {
      const res = await fetch(`/api/actions/${action.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setActions(snapshot);
      setActionError(`Couldn't delete "${action.name}" — please try again.`);
    }
  }

  return {
    actions,
    actionError,
    openModal,
    modalKey,
    /** Spread onto <ActionModal key={modalKey} {...modalProps} /> */
    modalProps: {
      isOpen: isModalOpen,
      onClose: closeModal,
      onSave: handleSave,
      onDelete: handleDelete,
      prefill: modalPrefill,
      editAction: modalEditAction,
    },
  };
}
