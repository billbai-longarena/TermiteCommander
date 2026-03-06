import React from "react";
import { Box, Text } from "ink";
import { truncate } from "../utils/formatters.js";
import type { SignalDetail } from "../../colony/signal-bridge.js";

interface SignalListProps {
  signals: SignalDetail[];
  maxItems?: number;
  termWidth?: number;
  offset?: number;
  selectedIndex?: number;
}

function statusIcon(status: string): { char: string; color: string } {
  switch (status) {
    case "done": case "completed": return { char: "\u2713", color: "green" };
    case "claimed": return { char: "\u25CF", color: "yellow" };
    case "open": return { char: "\u25CB", color: "gray" };
    default: return { char: "?", color: "gray" };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildScrollBar(total: number, offset: number, windowSize: number): string[] {
  if (windowSize <= 0) return [];
  if (total <= windowSize || total <= 1) {
    return Array.from({ length: windowSize }, () => "\u2502");
  }
  const thumbSize = Math.max(1, Math.round((windowSize * windowSize) / total));
  const maxThumbTop = windowSize - thumbSize;
  const ratio = offset / Math.max(1, total - windowSize);
  const thumbTop = Math.round(ratio * maxThumbTop);
  return Array.from({ length: windowSize }, (_, i) =>
    i >= thumbTop && i < thumbTop + thumbSize ? "\u2588" : "\u2502"
  );
}

export function SignalList({
  signals,
  maxItems = 8,
  termWidth = 80,
  offset = 0,
  selectedIndex = 0,
}: SignalListProps) {
  const viewport = Math.max(1, maxItems);
  const maxOffset = Math.max(0, signals.length - viewport);
  const start = clamp(offset, 0, maxOffset);
  const end = Math.min(signals.length, start + viewport);
  const display = signals.slice(start, end);
  const selected = signals.length > 0
    ? signals[clamp(selectedIndex, 0, signals.length - 1)]
    : null;
  const scrollBar = buildScrollBar(signals.length, start, Math.max(1, display.length));

  // pointer(2) + bar(2) + id(8) + type(10) + status(12) + owner(14)
  const fixedCols = 2 + 2 + 8 + 10 + 12 + 14;
  const titleMaxLen = Math.max(16, termWidth - fixedCols - 2);
  const titleColW = titleMaxLen + 2;

  return (
    <Box flexDirection="column">
      {display.map((s, row) => {
        const icon = statusIcon(s.status);
        const owner = s.claimedBy || "unassigned";
        const isSelected = start + row === selectedIndex;
        return (
          <Box key={s.id}>
            <Text color={isSelected ? "cyan" : undefined}>{isSelected ? ">" : " "}</Text>
            <Text dimColor>{` ${scrollBar[row] ?? "\u2502"}`}</Text>
            <Box>
              <Text>{s.id.padEnd(8)}</Text>
              <Text dimColor>{s.type.padEnd(10)}</Text>
              <Text>{truncate(s.title, titleMaxLen).padEnd(titleColW)}</Text>
              <Text color={icon.color}>{`${icon.char} ${s.status}`.padEnd(12)}</Text>
              <Text dimColor>{owner}</Text>
            </Box>
          </Box>
        );
      })}
      {signals.length > 0 && (
        <Text dimColor>{`  showing ${start + 1}-${end}/${signals.length} (j/k or ↑/↓ scroll, PgUp/PgDn jump)`}</Text>
      )}
      {signals.length === 0 && <Text dimColor>{"  No signals."}</Text>}

      {selected && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`  Selected ${selected.id}`}</Text>
          <Text wrap="wrap">{`    title: ${selected.title || "-"}`}</Text>
          <Text dimColor wrap="wrap">
            {`    meta: type=${selected.type} status=${selected.status} owner=${selected.claimedBy || "unassigned"} source=${selected.source || "-"} module=${selected.module || "-"} parent=${selected.parentId || "-"} depth=${selected.depth} weight=${selected.weight} touches=${selected.touchCount} tags=${selected.tags || "[]"}`}
          </Text>
          <Text wrap="wrap">{`    next_hint: ${selected.nextHint || "-"}`}</Text>
          <Text dimColor wrap="wrap">{`    child_hint: ${selected.childHint || "-"}`}</Text>
          <Text dimColor wrap="wrap">
            {`    parked: ${selected.parkedReason || "-"}${selected.parkedConditions ? ` | conditions=${selected.parkedConditions}` : ""}`}
          </Text>
        </Box>
      )}
    </Box>
  );
}
