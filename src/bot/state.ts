/**
 * Lightweight in-memory admin state for EDIT flow.
 * Survives for the lifetime of the process (fine for single-instance bot).
 */
export type AdminEditState = {
  submissionId: number;
  awaitingCaption: boolean;
};

const editStates = new Map<number, AdminEditState>();

export function setEditState(adminId: number, submissionId: number): void {
  editStates.set(adminId, { submissionId, awaitingCaption: true });
}

export function getEditState(adminId: number): AdminEditState | undefined {
  return editStates.get(adminId);
}

export function clearEditState(adminId: number): void {
  editStates.delete(adminId);
}
