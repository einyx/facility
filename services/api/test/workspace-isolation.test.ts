import { describe, expect, it } from "vitest";
import {
  assertNoHostDockerSocket,
  assertWorkspaceHostBoundary,
  isolationEventData,
  summarizeWorkspaceSignals,
  workspaceIsolationEvidence,
} from "../src/workspaces/isolation.js";

describe("workspace isolation evidence", () => {
  it("refuses a host docker socket bind", () => {
    expect(() =>
      assertNoHostDockerSocket({ Binds: ["/var/run/docker.sock:/var/run/docker.sock"] }),
    ).toThrow(/host docker socket/);
  });

  it("refuses a host docker socket mount", () => {
    expect(() =>
      assertNoHostDockerSocket({
        Mounts: [{ Type: "bind", Source: "/var/run/docker.sock", Target: "/var/run/docker.sock" }],
      }),
    ).toThrow(/host docker socket/);
  });

  it("refuses host networking", () => {
    expect(() => assertWorkspaceHostBoundary({ NetworkMode: "host" })).toThrow(/host network/);
  });

  it("allows the workspace volume mount", () => {
    expect(() =>
      assertNoHostDockerSocket({
        Mounts: [{ Type: "volume", Source: "facility-ws-volume-abc", Target: "/workspace" }],
      }),
    ).not.toThrow();
  });

  it("records isolation without secret fields", () => {
    expect(isolationEventData("docker")).toEqual({
      provider: "docker",
      hostDockerSocketMounted: false,
      hostNetwork: false,
      privileged: true,
      agentUser: "node",
      gaps: [
        "the container is privileged so nested dockerd can start",
        "every agent still has the project GitHub maintainer capability",
        "outbound network is not restricted",
      ],
    });
  });

  it("counts persisted workspace signals", () => {
    expect(
      summarizeWorkspaceSignals([
        "workspace.isolation",
        "workspace.provider_error",
        "workspace.suspend_failed",
        "workspace.ready",
      ]),
    ).toEqual({ isolationRecorded: 1, bootstrapFailures: 1, suspendFailures: 1 });
  });

  it("records the docker gaps a second team has to accept", () => {
    expect(workspaceIsolationEvidence("docker")).toMatchObject({
      hostDockerSocketMounted: false,
      hostNetwork: false,
      agentUser: "node",
      privileged: true,
      network: "workspace",
      trust: "maintainer",
    });
  });
});
