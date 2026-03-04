import { useState, useEffect, useRef } from "react";
import { SignalBridge, type SignalDetail } from "../../colony/signal-bridge.js";
import {
  readLockFile,
  readStatusFile,
  type LockData,
  type StatusFileData,
} from "../utils/colonyReader.js";

export interface ColonyStatus {
  total: number;
  open: number;
  claimed: number;
  done: number;
  blocked: number;
}

export interface ColonyState {
  status: ColonyStatus;
  signals: SignalDetail[];
  lockData: LockData | null;
  statusData: StatusFileData | null;
  isRunning: boolean;
  error: string | null;
}

const EMPTY_STATUS: ColonyStatus = {
  total: 0,
  open: 0,
  claimed: 0,
  done: 0,
  blocked: 0,
};

export function useColonyState(
  colonyRoot: string,
  refreshMs = 2000,
): ColonyState {
  const [state, setState] = useState<ColonyState>({
    status: EMPTY_STATUS,
    signals: [],
    lockData: null,
    statusData: null,
    isRunning: false,
    error: null,
  });
  const bridgeRef = useRef<SignalBridge | null>(null);

  useEffect(() => {
    bridgeRef.current = new SignalBridge(colonyRoot);

    const poll = async () => {
      try {
        const bridge = bridgeRef.current!;
        const bridgeStatus = await bridge.status();
        const signals = await bridge.listSignals();
        const lockData = readLockFile(colonyRoot);
        const statusData = readStatusFile(colonyRoot);

        let isRunning = false;
        if (lockData) {
          try {
            process.kill(lockData.pid, 0);
            isRunning = true;
          } catch {
            isRunning = false;
          }
        }

        setState({
          status: {
            total: bridgeStatus.total ?? 0,
            open: bridgeStatus.open ?? 0,
            claimed: bridgeStatus.claimed ?? 0,
            done: bridgeStatus.done ?? 0,
            blocked: 0,
          },
          signals,
          lockData,
          statusData,
          isRunning,
          error: null,
        });
      } catch (err: any) {
        setState((prev) => ({
          ...prev,
          error: err.message ?? "Failed to read colony state",
        }));
      }
    };

    poll();
    const timer = setInterval(poll, refreshMs);
    return () => clearInterval(timer);
  }, [colonyRoot, refreshMs]);

  return state;
}
