import { useEffect, useRef } from "react";

const consumeBack = () => {};

// Register for the open lifetime, keeping its position below newer overlays
// even when the owner replaces a callback or updates progress.
export function useDialogBack(pttchrome, opened, onClose = consumeBack) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!opened || !pttchrome?.registerSheetDismiss) return undefined;
    return pttchrome.registerSheetDismiss(() => closeRef.current());
  }, [pttchrome, opened]);
}
