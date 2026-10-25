import { describe, expect, it } from "vitest";
import {
  formatDoctorReport,
  missingSecretRefReport,
  runCli,
} from "./index.ts";

describe("doctor", () => {
  it("exits 1 for missing secret ref and never prints the secret value", async () => {
    const secret = "super-secret-token-value-9f3a";
    const report = missingSecretRefReport("GITHUB_TOKEN", secret);
    const stdout: string[] = [];

    const code = await runCli(["doctor"], {
      doctorReport: report,
      secretValues: [secret],
      io: {
        stdout: (l) => stdout.push(l),
        stderr: (l) => stdout.push(l),
      },
    });

    expect(code).toBe(1);
    const out = stdout.join("");
    expect(out).not.toContain(secret);
    expect(out).toMatch(/missing-secret-ref|GITHUB_TOKEN/i);
    expect(out).toContain("[redacted]");
  });

  it("exits 0 with an empty report", () => {
    const { exitCode, output } = formatDoctorReport({
      readable: true,
      findings: [],
    });
    expect(exitCode).toBe(0);
    expect(output).toMatch(/ok/i);
  });

  it("exits 2 when config is unreadable", () => {
    const { exitCode } = formatDoctorReport({
      readable: false,
      findings: [],
    });
    expect(exitCode).toBe(2);
  });
});
