import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

type ProtocolInstallStdioMode = "inherit" | "pipe";

export interface ProtocolInstallOptions {
  colonyRoot: string;
  skillSourceDir: string;
  logger?: (message: string) => void;
  stdioMode?: ProtocolInstallStdioMode;
}

export interface ProtocolInstallResult {
  installed: boolean;
  source: "existing" | "local-script" | "github-clone";
}

function logWithFallback(logger: ((message: string) => void) | undefined, message: string): void {
  if (logger) {
    logger(message);
    return;
  }
  console.log(message);
}

function emitBufferedLines(
  logger: ((message: string) => void) | undefined,
  output: string | Buffer | null | undefined,
): void {
  if (!logger || !output) return;
  const text = output.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      logger(line);
    }
  }
}

function runInstallCommand(
  command: string,
  args: string[],
  options: { logger?: (message: string) => void; stdioMode: ProtocolInstallStdioMode },
): void {
  if (options.stdioMode === "inherit") {
    execFileSync(command, args, { stdio: "inherit" });
    return;
  }

  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  emitBufferedLines(options.logger, result.stdout);
  emitBufferedLines(options.logger, result.stderr);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = `${result.stderr ?? result.stdout ?? ""}`.trim();
    throw new Error(detail || `Command failed: ${command} ${args.join(" ")}`);
  }
}

export function ensureTermiteProtocolInstalled(options: ProtocolInstallOptions): ProtocolInstallResult {
  const logger = options.logger;
  const stdioMode = options.stdioMode ?? "inherit";
  const dbScript = join(options.colonyRoot, "scripts", "termite-db.sh");

  if (existsSync(dbScript)) {
    logWithFallback(logger, "[commander] Termite Protocol detected.");
    return { installed: false, source: "existing" };
  }

  logWithFallback(logger, "[commander] Termite Protocol not found. Installing...");

  // Strategy 1: Local protocol source (monorepo/dev install)
  const localInstall = join(options.skillSourceDir, "../../../TermiteProtocol/install.sh");
  if (existsSync(localInstall)) {
    logWithFallback(logger, "[commander] Using local TermiteProtocol/install.sh");
    runInstallCommand("bash", [localInstall, options.colonyRoot], {
      logger,
      stdioMode,
    });
    logWithFallback(logger, "[commander] Termite Protocol installed.");
    return { installed: true, source: "local-script" };
  }

  // Strategy 2: Remote clone fallback
  logWithFallback(logger, "[commander] Cloning Termite Protocol from GitHub...");
  const tmpDir = join(options.colonyRoot, ".termite-install-tmp");
  try {
    runInstallCommand(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "https://github.com/billbai-longarena/Termite-Protocol.git",
        tmpDir,
      ],
      { logger, stdioMode },
    );
    runInstallCommand("bash", [join(tmpDir, "install.sh"), options.colonyRoot], {
      logger,
      stdioMode,
    });
    logWithFallback(logger, "[commander] Termite Protocol installed.");
    return { installed: true, source: "github-clone" };
  } catch {
    throw new Error(
      "Failed to install Termite Protocol automatically.\n" +
      "Install it manually:\n" +
      "  git clone https://github.com/billbai-longarena/Termite-Protocol /tmp/termite\n" +
      `  bash /tmp/termite/install.sh ${options.colonyRoot}\n` +
      "  rm -rf /tmp/termite",
    );
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}
