import { useState, useCallback, useRef, useEffect } from "react";
import { Pipeline, type PipelineConfig } from "../../engine/pipeline.js";
import type { Plan } from "../../colony/plan-writer.js";

export interface PipelineStreamState {
  phase: number;
  phaseLabel: string;
  messages: string[];
  isRunning: boolean;
  error: string | null;
  plan: Plan | null;
}

const PHASE_LABELS = [
  "分类任务",
  "调研中",
  "模拟场景",
  "设计架构",
  "信号分解",
  "质量标准",
];

// Save the real console.log once at module level
const originalConsoleLog = console.log;

export function usePipelineStreaming(config: PipelineConfig) {
  const [state, setState] = useState<PipelineStreamState>({
    phase: -1,
    phaseLabel: "",
    messages: [],
    isRunning: false,
    error: null,
    plan: null,
  });
  const pipelineRef = useRef<Pipeline | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Restore console.log on unmount in case pipeline is still running
      console.log = originalConsoleLog;
    };
  }, []);

  const safeSetState = useCallback(
    (updater: (prev: PipelineStreamState) => PipelineStreamState) => {
      if (mountedRef.current) {
        setState(updater);
      }
    },
    [],
  );

  const executePlan = useCallback(
    async (objective: string, runAfter: boolean): Promise<Plan | null> => {
      safeSetState(() => ({
        phase: 0,
        phaseLabel: PHASE_LABELS[0],
        messages: [],
        isRunning: true,
        error: null,
        plan: null,
      }));

      const captured: string[] = [];

      // Intercept console.log to capture pipeline progress
      console.log = (...args: any[]) => {
        const msg = args.map(String).join(" ");
        captured.push(msg);

        const phaseMatch = msg.match(/Phase (\d)/);
        if (phaseMatch) {
          const phaseNum = parseInt(phaseMatch[1], 10);
          safeSetState((prev) => ({
            ...prev,
            phase: phaseNum,
            phaseLabel: PHASE_LABELS[phaseNum] ?? `Phase ${phaseNum}`,
            messages: [...captured],
          }));
        } else {
          safeSetState((prev) => ({
            ...prev,
            messages: [...captured],
          }));
        }
      };

      let resultPlan: Plan | null = null;

      try {
        const pipeline = new Pipeline(config);
        pipelineRef.current = pipeline;

        const plan = await pipeline.plan(objective);
        resultPlan = plan;

        safeSetState((prev) => ({
          ...prev,
          phase: 6,
          phaseLabel: "完成",
          plan,
          messages: [...captured],
        }));

        if (runAfter) {
          safeSetState((prev) => ({
            ...prev,
            messages: [
              ...captured,
              "[commander] Dispatching signals and starting heartbeats...",
            ],
          }));
          // runWithHeartbeats runs indefinitely — fire and forget
          pipeline.runWithHeartbeats(plan).catch((err) => {
            safeSetState((prev) => ({
              ...prev,
              error: err.message,
            }));
          });
        }

        safeSetState((prev) => ({
          ...prev,
          isRunning: false,
        }));
      } catch (err: any) {
        safeSetState((prev) => ({
          ...prev,
          isRunning: false,
          error: err.message ?? "Pipeline failed",
          messages: [...captured],
        }));
      } finally {
        console.log = originalConsoleLog;
      }

      return resultPlan;
    },
    [config, safeSetState],
  );

  return { ...state, executePlan };
}
