import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface ProtocolInstallOptions {
  colonyRoot: string;
  skillSourceDir: string;
  logger?: (message: string) => void;
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

export function ensureTermiteProtocolInstalled(options: ProtocolInstallOptions): ProtocolInstallResult {
  const logger = options.logger;
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
    execFileSync("bash", [localInstall, options.colonyRoot], { stdio: "inherit" });
    logWithFallback(logger, "[commander] Termite Protocol installed.");
    return { installed: true, source: "local-script" };
  }

  // Strategy 2: Remote clone fallback
  logWithFallback(logger, "[commander] Cloning Termite Protocol from GitHub...");
  const tmpDir = join(options.colonyRoot, ".termite-install-tmp");
  try {
    execFileSync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "https://github.com/billbai-longarena/Termite-Protocol.git",
        tmpDir,
      ],
      { stdio: "inherit" },
    );
    execFileSync("bash", [join(tmpDir, "install.sh"), options.colonyRoot], {
      stdio: "inherit",
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
