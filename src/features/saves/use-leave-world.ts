import { useEffect, useRef } from "react";
import { useInterfaceStore } from "../interface/interface-store.ts";
import { saveBeforeLeaving } from "./saves-store.ts";

export function useLeaveWorld(): (leave: () => void) => void {
  const isMounted = useRef<boolean>(false);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  return (leave) => {
    const wasOpen = useInterfaceStore.getState().isSettingsOpen;

    saveBeforeLeaving(() => {
      const { isSettingsOpen, setSettingsOpen } = useInterfaceStore.getState();

      if (!isMounted.current || isSettingsOpen !== wasOpen) {
        return;
      }

      setSettingsOpen(false);
      leave();
    });
  };
}
