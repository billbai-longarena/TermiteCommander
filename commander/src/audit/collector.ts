import { execFile } from "node:child_process";
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AuditCollectorConfig {
  colonyRoot: string;
  protocolRoot: string;
}

export class AuditCollector {
  private config: AuditCollectorConfig;

  constructor(config: AuditCollectorConfig) {
    this.config = config;
  }

  async collectAuditPackage(): Promise<string> {
    const exportScript = join(this.config.colonyRoot, "scripts", "field-export-audit.sh");

    if (!existsSync(exportScript)) {
      throw new Error("field-export-audit.sh not found in colony");
    }

    const { stdout } = await execFileAsync("bash", [exportScript], {
      cwd: this.config.colonyRoot,
      timeout: 60_000,
    });

    console.log(`[audit] Export output: ${stdout.trim()}`);

    const auditDir = join(this.config.colonyRoot, "audit-export");
    if (!existsSync(auditDir)) {
      throw new Error("Audit export directory not created");
    }

    return auditDir;
  }

  async copyToProtocolRepo(auditDir: string, projectName: string): Promise<string> {
    const date = new Date().toISOString().split("T")[0];
    const destDir = join(
      this.config.protocolRoot,
      "audit-packages",
      projectName,
      date,
    );

    mkdirSync(destDir, { recursive: true });
    cpSync(auditDir, destDir, { recursive: true });

    console.log(`[audit] Copied audit package to ${destDir}`);
    return destDir;
  }
}
