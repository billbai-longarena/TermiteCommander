#!/usr/bin/env node

import { program } from "commander";

program
  .name("commander")
  .description("Termite Commander — autonomous orchestration engine")
  .version("0.1.0");

program
  .command("plan <objective>")
  .description("Plan and decompose an objective into colony signals")
  .action(async (objective: string) => {
    console.log(`[commander] Received objective: ${objective}`);
  });

program
  .command("status")
  .description("Show colony status")
  .action(async () => {
    console.log("[commander] Status check...");
  });

program.parse();
