import { describe, it, expect, beforeEach } from "vitest";
import { useCapabilitiesStore } from "../capabilitiesStore";
import type { ServerCapabilities } from "../../types/database";

describe("capabilitiesStore", () => {
  beforeEach(() => {
    useCapabilitiesStore.getState().clearCapabilities();
  });

  const mockCapabilities: ServerCapabilities = {
    engine: "mysql",
    features: ["routines", "events", "sqlDump", "healthMonitor"],
    version: {
      raw_version: "10.11.6-MariaDB",
      variant: "MariaDb",
      major: 10,
      minor: 11,
      patch: 6,
      normalized_display: "MariaDB 10.11.6 (LTS)",
      is_lts: true,
    },
    current_user: "root@localhost",
    current_database: "test",
    analyze_format_json: {
      id: "analyze_format_json",
      name: "ANALYZE FORMAT=JSON",
      description: "Execution telemetry",
      status: { status: "Compatible" },
      category: "Diagnostics",
    },
    system_versioning: {
      id: "system_versioning",
      name: "System-Versioned Tables",
      description: "Temporal history",
      status: { status: "Compatible" },
      category: "Storage",
    },
    vector_search: {
      id: "vector_search",
      name: "Vector Types",
      description: "Embeddings",
      status: {
        status: "UnsupportedVersion",
        detail: { min_version: "MariaDB 11.7.0+", current_version: "MariaDB 10.11.6 (LTS)" },
      },
      category: "AI & Vectors",
    },
    scheduled_events: {
      id: "scheduled_events",
      name: "Event Scheduler",
      description: "Events",
      status: {
        status: "DisabledByConfig",
        detail: { variable_name: "event_scheduler", current_value: "OFF", expected_value: "ON" },
      },
      category: "Automation",
    },
    sequences: {
      id: "sequences",
      name: "Sequences",
      description: "Sequences",
      status: { status: "Compatible" },
      category: "Storage",
    },
    partitions: {
      id: "partitions",
      name: "Partitions",
      description: "Partitions",
      status: { status: "Compatible" },
      category: "Storage",
    },
    modern_collations: {
      id: "modern_collations",
      name: "Modern Collations",
      description: "UCA-1400",
      status: {
        status: "UnsupportedVersion",
        detail: { min_version: "MariaDB 11.4.0", current_version: "MariaDB 10.11.6 (LTS)" },
      },
      category: "Storage",
    },
    parsec_auth: {
      id: "parsec_auth",
      name: "PARSEC Auth",
      description: "Auth",
      status: {
        status: "UnsupportedVersion",
        detail: { min_version: "MariaDB 11.4.0", current_version: "MariaDB 10.11.6 (LTS)" },
      },
      category: "Security",
    },
    items: [],
  };

  it("should evaluate compatible features correctly", () => {
    useCapabilitiesStore.setState({ capabilities: mockCapabilities });
    const { isAvailable, getExplanation } = useCapabilitiesStore.getState();

    expect(isAvailable("analyze_format_json")).toBe(true);
    expect(isAvailable("system_versioning")).toBe(true);
    expect(isAvailable("sequences")).toBe(true);
    expect(getExplanation("system_versioning")).toContain("totalmente compatible");
  });

  it("should report unsupported version with clean explanation and resolution", () => {
    useCapabilitiesStore.setState({ capabilities: mockCapabilities });
    const { isAvailable, getExplanation, getResolution } = useCapabilitiesStore.getState();

    expect(isAvailable("vector_search")).toBe(false);
    expect(getExplanation("vector_search")).toContain("Requiere versión MariaDB 11.7.0+");
    expect(getResolution("vector_search")).toContain("Actualiza el servidor MariaDB");
  });

  it("should report disabled by config with variable name and resolution", () => {
    useCapabilitiesStore.setState({ capabilities: mockCapabilities });
    const { isAvailable, getExplanation, getResolution } = useCapabilitiesStore.getState();

    expect(isAvailable("scheduled_events")).toBe(false);
    expect(getExplanation("scheduled_events")).toContain("event_scheduler = 'OFF'");
    expect(getResolution("scheduled_events")).toContain("SET GLOBAL event_scheduler = ON");
  });

  describe("engine feature gating", () => {
    const sqliteCapabilities: ServerCapabilities = {
      ...mockCapabilities,
      engine: "sqlite",
      features: ["fileBackup"],
    };

    it("assumes every feature while capabilities are loading", () => {
      const { supportsFeature } = useCapabilitiesStore.getState();
      expect(supportsFeature("routines")).toBe(true);
      expect(supportsFeature("fileBackup")).toBe(true);
    });

    it("hides server-only features on SQLite", () => {
      useCapabilitiesStore.setState({ capabilities: sqliteCapabilities });
      const { supportsFeature } = useCapabilitiesStore.getState();
      expect(supportsFeature("routines")).toBe(false);
      expect(supportsFeature("healthMonitor")).toBe(false);
      expect(supportsFeature("fileBackup")).toBe(true);
    });

    it("keeps MariaDB/MySQL features and does not offer the file backup", () => {
      useCapabilitiesStore.setState({ capabilities: mockCapabilities });
      const { supportsFeature } = useCapabilitiesStore.getState();
      expect(supportsFeature("routines")).toBe(true);
      expect(supportsFeature("fileBackup")).toBe(false);
    });

    it("explains why an item does not apply to the engine", () => {
      useCapabilitiesStore.setState({
        capabilities: {
          ...sqliteCapabilities,
          items: [
            {
              id: "event_scheduler_status",
              name: "Event scheduler",
              description: "",
              status: { status: "UnsupportedEngine", detail: { engine: "SQLite" } },
              category: "Storage",
            },
          ],
        },
      });
      expect(useCapabilitiesStore.getState().getExplanation("event_scheduler_status")).toBe(
        "No disponible en SQLite.",
      );
    });
  });
});
