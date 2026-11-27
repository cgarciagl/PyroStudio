import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = "cgarciagl/PyroStudio";

/**
 * Classifies a GitHub Release asset into binary / updater / checksum,
 * platform (windows / macos / linux / other / updater / meta), and format label.
 */
export function classifyAsset(name) {
  const lower = String(name || "").toLowerCase();

  if (lower === "latest.json") {
    return { kind: "updater", platform: "updater", format: "Updater manifest (latest.json)" };
  }
  if (
    lower.endsWith(".sig") ||
    lower.endsWith(".sha256") ||
    lower.endsWith(".sha512") ||
    lower.endsWith(".asc") ||
    lower.endsWith(".minisig")
  ) {
    return { kind: "checksum", platform: "meta", format: "Signature / Checksum" };
  }
  if (lower.endsWith(".exe")) {
    if (lower.includes("portable")) {
      return { kind: "binary", platform: "windows", format: "Windows Portable (.exe)" };
    }
    return { kind: "binary", platform: "windows", format: "Windows Setup (.exe)" };
  }
  if (lower.endsWith(".msi")) {
    return { kind: "binary", platform: "windows", format: "Windows MSI (.msi)" };
  }
  if (lower.endsWith(".dmg")) {
    return { kind: "binary", platform: "macos", format: "macOS DMG (.dmg)" };
  }
  if (lower.endsWith(".app.tar.gz") || lower.endsWith(".pkg")) {
    return { kind: "binary", platform: "macos", format: "macOS Updater (.app.tar.gz)" };
  }
  if (lower.endsWith(".appimage")) {
    return { kind: "binary", platform: "linux", format: "Linux AppImage" };
  }
  if (lower.endsWith(".deb")) {
    return { kind: "binary", platform: "linux", format: "Linux DEB (.deb)" };
  }
  if (lower.endsWith(".rpm")) {
    return { kind: "binary", platform: "linux", format: "Linux RPM (.rpm)" };
  }
  return { kind: "binary", platform: "other", format: "Other" };
}

/**
 * Aggregates GitHub releases API payload into structured totals,
 * per-platform counts, per-format counts, and per-release details.
 */
export function aggregateReleases(rawReleases) {
  const platforms = { windows: 0, macos: 0, linux: 0, other: 0 };
  const formats = {};
  let totalBinaryDownloads = 0;
  let totalUpdaterChecks = 0;
  let totalChecksumDownloads = 0;

  const releases = rawReleases
    .filter((r) => !r.draft)
    .map((release) => {
      const relPlatforms = { windows: 0, macos: 0, linux: 0, other: 0 };
      let relBinaryTotal = 0;
      let relUpdater = 0;
      let relChecksums = 0;

      const assets = (release.assets || []).map((asset) => {
        const downloads = Number(asset.download_count || 0);
        const cls = classifyAsset(asset.name);

        if (cls.kind === "binary") {
          relBinaryTotal += downloads;
          totalBinaryDownloads += downloads;
          relPlatforms[cls.platform] = (relPlatforms[cls.platform] || 0) + downloads;
          platforms[cls.platform] = (platforms[cls.platform] || 0) + downloads;
          formats[cls.format] = (formats[cls.format] || 0) + downloads;
        } else if (cls.kind === "updater") {
          relUpdater += downloads;
          totalUpdaterChecks += downloads;
        } else {
          relChecksums += downloads;
          totalChecksumDownloads += downloads;
        }

        return {
          name: asset.name,
          downloads,
          size: Number(asset.size || 0),
          kind: cls.kind,
          platform: cls.platform,
          format: cls.format,
          downloadUrl: asset.browser_download_url || "",
          updatedAt: asset.updated_at || null,
        };
      });

      const publishedAt = release.published_at || release.created_at || null;
      const ageDays = publishedAt
        ? Math.max(1, Math.round((Date.now() - new Date(publishedAt).getTime()) / 86_400_000))
        : 1;
      const downloadsPerDay = Number((relBinaryTotal / ageDays).toFixed(2));

      return {
        tag: release.tag_name,
        name: release.name || release.tag_name,
        publishedAt,
        ageDays,
        downloadsPerDay,
        prerelease: Boolean(release.prerelease),
        htmlUrl: release.html_url || "",
        total: relBinaryTotal,
        platforms: relPlatforms,
        updaterChecks: relUpdater,
        checksumDownloads: relChecksums,
        assets,
      };
    })
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());

  const formatList = Object.entries(formats)
    .map(([format, downloads]) => ({ format, downloads }))
    .sort((a, b) => b.downloads - a.downloads);

  return {
    total: totalBinaryDownloads,
    platforms,
    updaterChecks: totalUpdaterChecks,
    checksumDownloads: totalChecksumDownloads,
    formats: formatList,
    releases,
  };
}

/**
 * Merges GitHub's 14-day rolling daily traffic arrays (views & clones)
 * into a permanent chronological history array keyed by UTC date (YYYY-MM-DD).
 */
export function mergeTrafficHistory(existing, dailyViews = [], dailyClones = []) {
  const byDate = new Map();
  for (const entry of Array.isArray(existing) ? existing : []) {
    if (entry && typeof entry.date === "string") {
      byDate.set(entry.date, {
        date: entry.date,
        views: Number(entry.views || 0),
        uniqueVisitors: Number(entry.uniqueVisitors || 0),
        clones: Number(entry.clones || 0),
        uniqueCloners: Number(entry.uniqueCloners || 0),
      });
    }
  }

  for (const v of Array.isArray(dailyViews) ? dailyViews : []) {
    const date = String(v.timestamp || "").slice(0, 10);
    if (!date) continue;
    const prev = byDate.get(date) || { date, views: 0, uniqueVisitors: 0, clones: 0, uniqueCloners: 0 };
    byDate.set(date, {
      ...prev,
      views: Number(v.count || 0),
      uniqueVisitors: Number(v.uniques || 0),
    });
  }

  for (const c of Array.isArray(dailyClones) ? dailyClones : []) {
    const date = String(c.timestamp || "").slice(0, 10);
    if (!date) continue;
    const prev = byDate.get(date) || { date, views: 0, uniqueVisitors: 0, clones: 0, uniqueCloners: 0 };
    byDate.set(date, {
      ...prev,
      clones: Number(c.count || 0),
      uniqueCloners: Number(c.uniques || 0),
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Upserts a daily snapshot into the chronological history array (sorted by date ASC).
 */
export function upsertHistory(existingHistory, snapshot) {
  const byDate = new Map();
  for (const entry of Array.isArray(existingHistory) ? existingHistory : []) {
    if (entry && typeof entry.date === "string") {
      byDate.set(entry.date, entry);
    }
  }
  byDate.set(snapshot.date, snapshot);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function findReferenceSnapshot(history, daysBack) {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const latestMs = new Date(`${latest.date}T00:00:00Z`).getTime();
  const targetMs = latestMs - daysBack * 86_400_000;

  let candidate = null;
  for (let i = 0; i < history.length - 1; i++) {
    const entryMs = new Date(`${history[i].date}T00:00:00Z`).getTime();
    if (entryMs <= targetMs) {
      candidate = history[i];
    } else if (!candidate) {
      // Earliest available snapshot if history is shorter than daysBack
      candidate = history[i];
      break;
    }
  }
  return candidate;
}

function computeDelta(latest, ref) {
  if (!latest || !ref) return null;
  return {
    fromDate: ref.date,
    total: latest.total - ref.total,
    windows: (latest.platforms?.windows || 0) - (ref.platforms?.windows || 0),
    macos: (latest.platforms?.macos || 0) - (ref.platforms?.macos || 0),
    linux: (latest.platforms?.linux || 0) - (ref.platforms?.linux || 0),
    updaterChecks: (latest.updaterChecks || 0) - (ref.updaterChecks || 0),
    stars: (latest.stars || 0) - (ref.stars || 0),
  };
}

/**
 * Builds the precomputed summary.json payload consumed by the dashboard.
 */
export function buildSummary({ repo, updatedAt, repoInfo, aggregated, history, traffic }) {
  const latest = history[history.length - 1] || null;
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const ref7d = findReferenceSnapshot(history, 7);
  const ref30d = findReferenceSnapshot(history, 30);

  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    updatedAt,
    historyDays: history.length,
    firstDate: history[0]?.date || null,
    lastDate: latest?.date || null,
    totals: {
      downloads: aggregated.total,
      platforms: aggregated.platforms,
      updaterChecks: aggregated.updaterChecks,
      checksumDownloads: aggregated.checksumDownloads,
      releasesCount: aggregated.releases.length,
    },
    community: {
      stars: Number(repoInfo?.stargazers_count || 0),
      forks: Number(repoInfo?.forks_count || 0),
      openIssues: Number(repoInfo?.open_issues_count || 0),
      watchers: Number(repoInfo?.subscribers_count || 0),
    },
    traffic: traffic || null,
    deltas: {
      lastDay: computeDelta(latest, prev),
      last7d: computeDelta(latest, ref7d),
      last30d: computeDelta(latest, ref30d),
    },
    latestRelease: aggregated.releases[0] || null,
    formats: aggregated.formats,
    releases: aggregated.releases,
  };
}

/**
 * Converts history snapshots into a flat RFC-4180 CSV string.
 */
export function buildCsv(history) {
  const headers = [
    "date",
    "total_downloads",
    "delta_downloads",
    "windows",
    "macos",
    "linux",
    "other",
    "updater_checks",
    "delta_updater_checks",
    "stars",
    "forks",
  ];
  const lines = [headers.join(",")];
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    const prev = i > 0 ? history[i - 1] : null;
    const delta = prev ? row.total - prev.total : 0;
    const deltaUpdater = prev ? Math.max(0, (row.updaterChecks || 0) - (prev.updaterChecks || 0)) : 0;
    lines.push(
      [
        row.date,
        row.total,
        delta,
        row.platforms?.windows || 0,
        row.platforms?.macos || 0,
        row.platforms?.linux || 0,
        row.platforms?.other || 0,
        row.updaterChecks || 0,
        deltaUpdater,
        row.stars || 0,
        row.forks || 0,
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Generates a concise Markdown report for $GITHUB_STEP_SUMMARY.
 */
export function buildMarkdownSummary(summary) {
  const { totals, community, deltas, releases, repo, updatedAt } = summary;
  const d1 = deltas.lastDay ? ` (+${deltas.lastDay.total} vs ${deltas.lastDay.fromDate})` : "";
  const lines = [
    `## 🔥 PyroStudio Download Stats — \`${repo}\``,
    "",
    `> Actualizado: \`${updatedAt}\` · Histórico acumulado: **${summary.historyDays} día(s)**`,
    "",
    "| Métrica | Total |",
    "| :--- | ---: |",
    `| **Descargas de binarios** | **${totals.downloads}**${d1} |`,
    `| Windows | ${totals.platforms.windows} |`,
    `| macOS | ${totals.platforms.macos} |`,
    `| Linux | ${totals.platforms.linux} |`,
    `| Chequeos del updater (\`latest.json\`) | ${totals.updaterChecks} |`,
    `| Stars / Forks | ${community.stars} / ${community.forks} |`,
    "",
    "### Por release",
    "",
    "| Release | Fecha | Windows | macOS | Linux | Total | `latest.json` |",
    "| :--- | :--- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const rel of releases) {
    const pub = rel.publishedAt ? rel.publishedAt.slice(0, 10) : "—";
    lines.push(
      `| \`${rel.tag}\` | ${pub} | ${rel.platforms.windows} | ${rel.platforms.macos} | ${rel.platforms.linux} | **${rel.total}** | ${rel.updaterChecks} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function githubHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PyroStudio-Stats-Collector/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson(url, token) {
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    const err = new Error(`GitHub API ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return { data: await res.json(), link: res.headers.get("link") || "" };
}

async function fetchAllReleases(repo, token) {
  const all = [];
  let url = `https://api.github.com/repos/${repo}/releases?per_page=100`;
  while (url) {
    const { data, link } = await fetchJson(url, token);
    if (Array.isArray(data)) all.push(...data);
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;
  }
  return all;
}

async function fetchOptionalTraffic(repo, token) {
  if (!token) return null;
  try {
    const [{ data: views }, { data: clones }, { data: referrers }, { data: paths }] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${repo}/traffic/views`, token),
      fetchJson(`https://api.github.com/repos/${repo}/traffic/clones`, token),
      fetchJson(`https://api.github.com/repos/${repo}/traffic/popular/referrers`, token),
      fetchJson(`https://api.github.com/repos/${repo}/traffic/popular/paths`, token),
    ]);
    return {
      views14d: Number(views?.count || 0),
      uniqueVisitors14d: Number(views?.uniques || 0),
      clones14d: Number(clones?.count || 0),
      uniqueCloners14d: Number(clones?.uniques || 0),
      dailyViews: Array.isArray(views?.views) ? views.views : [],
      dailyClones: Array.isArray(clones?.clones) ? clones.clones : [],
      referrers: (Array.isArray(referrers) ? referrers : []).map((r) => ({
        referrer: r.referrer,
        count: Number(r.count || 0),
        uniques: Number(r.uniques || 0),
      })),
      paths: (Array.isArray(paths) ? paths : []).map((p) => ({
        path: p.path,
        title: p.title || p.path,
        count: Number(p.count || 0),
        uniques: Number(p.uniques || 0),
      })),
    };
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      return null;
    }
    throw err;
  }
}

function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    outDir: path.resolve(__dirname, "../../.stats-preview"),
    summaryMd: null,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) args.repo = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) args.outDir = path.resolve(argv[++i]);
    else if (argv[i] === "--summary-md" && argv[i + 1]) args.summaryMd = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const trafficToken = process.env.STATS_TRAFFIC_TOKEN || token;
  const now = new Date();
  const dateUtc = now.toISOString().slice(0, 10);
  const updatedAt = now.toISOString();

  console.log(`[stats] Recolectando estadísticas de ${args.repo} (${dateUtc})...`);

  const [rawReleases, { data: repoInfo }, rawTraffic] = await Promise.all([
    fetchAllReleases(args.repo, token),
    fetchJson(`https://api.github.com/repos/${args.repo}`, token),
    fetchOptionalTraffic(args.repo, trafficToken),
  ]);

  const aggregated = aggregateReleases(rawReleases);

  const dataDir = path.join(args.outDir, "data");
  await mkdir(dataDir, { recursive: true });

  const historyPath = path.join(dataDir, "history.json");
  let existingHistory = [];
  try {
    existingHistory = JSON.parse(await readFile(historyPath, "utf8"));
  } catch {
    existingHistory = [];
  }

  const trafficHistoryPath = path.join(dataDir, "traffic-history.json");
  let existingTrafficHistory = [];
  try {
    existingTrafficHistory = JSON.parse(await readFile(trafficHistoryPath, "utf8"));
  } catch {
    existingTrafficHistory = [];
  }

  let traffic = null;
  let trafficHistory = existingTrafficHistory;
  if (rawTraffic) {
    trafficHistory = mergeTrafficHistory(existingTrafficHistory, rawTraffic.dailyViews, rawTraffic.dailyClones);
    traffic = {
      views14d: rawTraffic.views14d,
      uniqueVisitors14d: rawTraffic.uniqueVisitors14d,
      clones14d: rawTraffic.clones14d,
      uniqueCloners14d: rawTraffic.uniqueCloners14d,
      referrers: rawTraffic.referrers,
      paths: rawTraffic.paths,
      daily: trafficHistory,
    };
  }

  const releaseMap = {};
  for (const rel of aggregated.releases) {
    releaseMap[rel.tag] = {
      total: rel.total,
      windows: rel.platforms.windows,
      macos: rel.platforms.macos,
      linux: rel.platforms.linux,
      updater: rel.updaterChecks,
    };
  }

  const snapshot = {
    date: dateUtc,
    updatedAt,
    total: aggregated.total,
    platforms: aggregated.platforms,
    updaterChecks: aggregated.updaterChecks,
    stars: Number(repoInfo?.stargazers_count || 0),
    forks: Number(repoInfo?.forks_count || 0),
    openIssues: Number(repoInfo?.open_issues_count || 0),
    releases: releaseMap,
    ...(traffic
      ? {
          traffic: {
            views14d: traffic.views14d,
            uniqueVisitors14d: traffic.uniqueVisitors14d,
            clones14d: traffic.clones14d,
            uniqueCloners14d: traffic.uniqueCloners14d,
          },
        }
      : {}),
  };

  const history = upsertHistory(existingHistory, snapshot);
  const summary = buildSummary({
    repo: args.repo,
    updatedAt,
    repoInfo,
    aggregated,
    history,
    traffic,
  });
  const csv = buildCsv(history);

  const writes = [
    writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8"),
    writeFile(path.join(dataDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
    writeFile(path.join(dataDir, "history.csv"), csv, "utf8"),
    writeFile(path.join(args.outDir, ".nojekyll"), "", "utf8"),
    copyFile(path.join(__dirname, "dashboard", "index.html"), path.join(args.outDir, "index.html")),
  ];
  if (traffic) {
    writes.push(writeFile(trafficHistoryPath, `${JSON.stringify(trafficHistory, null, 2)}\n`, "utf8"));
  }
  await Promise.all(writes);

  if (args.summaryMd) {
    await writeFile(args.summaryMd, buildMarkdownSummary(summary), { flag: "a", encoding: "utf8" });
  }

  console.log(
    `[stats] Listo: ${summary.totals.downloads} descargas binarias (${summary.totals.platforms.windows} Win / ${summary.totals.platforms.macos} macOS / ${summary.totals.platforms.linux} Linux), ${summary.totals.updaterChecks} updater checks. Histórico: ${history.length} día(s).${traffic ? ` Tráfico 14d: ${traffic.views14d} vistas (${traffic.uniqueVisitors14d} únicas).` : ""}`,
  );
  console.log(`[stats] Dashboard generado en: ${args.outDir}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error("[stats] Error:", err);
    process.exit(1);
  });
}
