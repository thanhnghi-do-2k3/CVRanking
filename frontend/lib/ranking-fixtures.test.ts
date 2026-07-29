import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type FixtureManifest = {
  sets: Array<{
    id: string;
    job_config_path: string;
    cvs: Array<{ name: string; path: string }>;
  }>;
};

describe("ranking workspace fixtures", () => {
  it("ships JD configs and CV batches for the HR workspace flow", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("public/ranking-fixtures/manifest.json"), "utf-8"),
    ) as FixtureManifest;

    expect(manifest.sets.length).toBeGreaterThanOrEqual(3);
    expect(manifest.sets[0]?.job_config_path).toContain("/ranking-fixtures/jobs/");
    expect(manifest.sets[0]?.cvs.length).toBeGreaterThanOrEqual(4);
  });
});
