import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface CommandPromptProps {
  onSubmit: (input: string) => void;
  disabled?: boolean;
}

export function CommandPrompt({ onSubmit, disabled }: CommandPromptProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (input: string) => {
    if (!input.trim()) return;
    onSubmit(input.trim());
    setValue("");
  };

  return (
    <Box>
      <Text color="green" bold>
        {"❯ "}
      </Text>
      {disabled ? (
        <Text dimColor>Processing...</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="Enter command or objective..."
        />
      )}
    </Box>
  );
}
