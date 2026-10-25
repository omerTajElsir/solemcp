import { redact } from "@solemcp/core";

export type DoctorSeverity = "warning" | "error";

export interface DoctorFinding {
  severity: DoctorSeverity;
  code: string;
  message: string;
}

export interface DoctorReport {
  /** False when config cannot be read/parsed. */
  readable: boolean;
  findings: DoctorFinding[];
  /** Secret values that must never appear in printed output. */
  secretValues?: string[];
}

export interface DoctorRunResult {
  exitCode: 0 | 1 | 2;
  output: string;
}

/**
 * Format and grade a doctor report.
 * Exit 0 = no warnings, 1 = warnings, 2 = unreadable.
 * Never prints secret values (uses core redact).
 */
export function formatDoctorReport(report: DoctorReport): DoctorRunResult {
  const secrets = report.secretValues ?? [];
  const lines: string[] = [];

  if (!report.readable) {
    lines.push(redact("doctor: config unreadable", secrets));
    for (const f of report.findings) {
      lines.push(redact(`[${f.severity}] ${f.code}: ${f.message}`, secrets));
    }
    return { exitCode: 2, output: `${lines.join("\n")}\n` };
  }

  if (report.findings.length === 0) {
    return { exitCode: 0, output: "doctor: ok\n" };
  }

  for (const f of report.findings) {
    lines.push(redact(`[${f.severity}] ${f.code}: ${f.message}`, secrets));
  }
  return { exitCode: 1, output: `${lines.join("\n")}\n` };
}

/** Convenience fixture: missing secret ref without leaking the value. */
export function missingSecretRefReport(
  refName: string,
  secretValue: string,
): DoctorReport {
  return {
    readable: true,
    secretValues: [secretValue],
    findings: [
      {
        severity: "warning",
        code: "missing-secret-ref",
        message: `connector secret ref ${refName} is missing (value must not be printed: ${secretValue})`,
      },
    ],
  };
}
