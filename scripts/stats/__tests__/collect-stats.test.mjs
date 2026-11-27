import { describe, expect, it } from "vitest";
import {
  aggregateReleases,
  buildCsv,
  buildSummary,
  classifyAsset,
  upsertHistory,
} from "../collect-stats.mjs";

describe("collect-stats", () => {
  it("classifies binaries, updater manifests, and signatures accurately", () => {
    expect(classifyAsset("PyroStudio_v1.4.0_x64_portable.exe")).toEqual({
      kind: "binary",
      platform: "windows",
      format: "Windows Portable (.exe)",
    });
    expect(classifyAsset("Pyro.Studio_1.4.0_x64-setup.exe")).toEqual({
      kind: "binary",
      platform: "windows",
      format: "Windows Setup (.exe)",
    });
    expect(classifyAsset("Pyro.Studio_1.4.0_x64_en-US.msi").platform).toBe("windows");
    expect(classifyAsset("Pyro.Studio_1.4.0_universal.dmg").platform).toBe("macos");
    expect(classifyAsset("Pyro.Studio_universal.app.tar.gz").platform).toBe("macos");
    expect(classifyAsset("Pyro.Studio_1.4.0_amd64.AppImage").platform).toBe("linux");
    expect(classifyAsset("Pyro.Studio_1.4.0_amd64.deb").platform).toBe("linux");
    expect(classifyAsset("Pyro.Studio-1.4.0-1.x86_64.rpm").platform).toBe("linux");

    expect(classifyAsset("latest.json").kind).toBe("updater");
    expect(classifyAsset("Pyro.Studio_1.4.0_x64-setup.exe.sig").kind).toBe("checksum");
    expect(classifyAsset("PyroStudio_v1.4.0_x64_portable.exe.sha256").kind).toBe("checksum");
  });

  it("aggregates only real binaries into totals and tracks updater checks separately", () => {
    const agg = aggregateReleases([
      {
        tag_name: "v1.4.0",
        name: "Pyro Studio v1.4.0",
        published_at: "2026-11-27T00:00:00Z",
        draft: false,
        prerelease: false,
        html_url: "https://github.com/cgarciagl/PyroStudio/releases/tag/v1.4.0",
        assets: [
          { name: "PyroStudio_v1.4.0_x64_portable.exe", download_count: 5, size: 1000 },
          { name: "PyroStudio_v1.4.0_x64_portable.exe.sha256", download_count: 5, size: 100 },
          { name: "Pyro.Studio_1.4.0_universal.dmg", download_count: 3, size: 2000 },
          { name: "Pyro.Studio_1.4.0_amd64.AppImage", download_count: 4, size: 3000 },
          { name: "latest.json", download_count: 12, size: 500 },
        ],
      },
      {
        tag_name: "v1.5.0-draft",
        draft: true,
        assets: [{ name: "ignored.exe", download_count: 99 }],
      },
    ]);

    expect(agg.total).toBe(12);
    expect(agg.platforms).toEqual({ windows: 5, macos: 3, linux: 4, other: 0 });
    expect(agg.updaterChecks).toBe(12);
    expect(agg.checksumDownloads).toBe(5);
    expect(agg.releases).toHaveLength(1);
  });

  it("upserts history idempotently by UTC date and computes deltas & CSV", () => {
    const initial = [
      { date: "2026-11-25", total: 30, platforms: { windows: 12, macos: 6, linux: 12, other: 0 }, updaterChecks: 10, stars: 5, forks: 1 },
    ];
    const updated = upsertHistory(initial, {
      date: "2026-11-26",
      total: 42,
      platforms: { windows: 19, macos: 7, linux: 16, other: 0 },
      updaterChecks: 17,
      stars: 8,
      forks: 2,
    });
    const idempotent = upsertHistory(updated, {
      date: "2026-11-26",
      total: 45,
      platforms: { windows: 20, macos: 8, linux: 17, other: 0 },
      updaterChecks: 19,
      stars: 9,
      forks: 2,
    });

    expect(idempotent).toHaveLength(2);
    expect(idempotent[1].total).toBe(45);

    const summary = buildSummary({
      repo: "cgarciagl/PyroStudio",
      updatedAt: "2026-11-26T06:00:00Z",
      repoInfo: { stargazers_count: 9, forks_count: 2, open_issues_count: 1, subscribers_count: 3 },
      aggregated: { total: 45, platforms: { windows: 20, macos: 8, linux: 17, other: 0 }, updaterChecks: 19, checksumDownloads: 5, formats: [], releases: [] },
      history: idempotent,
      traffic: null,
    });

    expect(summary.deltas.lastDay?.total).toBe(15);
    expect(summary.deltas.lastDay?.windows).toBe(8);

    const csv = buildCsv(idempotent);
    expect(csv.trim().split("\n")).toHaveLength(3);
    expect(csv).toContain("2026-11-26,45,15,20,8,17,0,19,9,9,2");
  });
});
