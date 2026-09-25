export type WorkspaceIsolationEvidence = {
  provider: "docker" | "vercel" | "fake";
  hostDockerSocketMounted: boolean;
  hostNetwork: boolean;
  agentUser: "node" | "unisolated";
  bootstrapUser: "root" | "unisolated";
  privileged: boolean;
  network: "workspace" | "provider" | "none";
  trust: "maintainer";
  gaps: string[];
};

type HostMount = { Source?: string; Target?: string; Type?: string };

export function assertWorkspaceHostBoundary(hostConfig: {
  Binds?: string[];
  Mounts?: HostMount[];
  NetworkMode?: string;
}) {
  const sources = [
    ...(hostConfig.Binds ?? []).map((bind) => bind.split(":")[0] ?? ""),
    ...(hostConfig.Mounts ?? []).map((mount) => mount.Source ?? ""),
  ];
  if (sources.some((source) => source === "/var/run/docker.sock" || source.endsWith("/docker.sock"))) {
    throw new Error("host docker socket must not be mounted into a story workspace");
  }
  if (hostConfig.NetworkMode === "host") {
    throw new Error("story workspace must not join the host network");
  }
}

export function assertNoHostDockerSocket(hostConfig: {
  Binds?: string[];
  Mounts?: HostMount[];
}) {
  assertWorkspaceHostBoundary(hostConfig);
}

export function isolationEventData(
  provider: WorkspaceIsolationEvidence["provider"],
  actual?: {
    hostDockerSocketMounted: boolean;
    hostNetwork: boolean;
    privileged: boolean;
  },
) {
  const evidence = workspaceIsolationEvidence(provider, actual);
  return {
    provider: evidence.provider,
    hostDockerSocketMounted: evidence.hostDockerSocketMounted,
    hostNetwork: evidence.hostNetwork,
    privileged: evidence.privileged,
    agentUser: evidence.agentUser,
    gaps: evidence.gaps,
  };
}

const SIGNAL_TYPES = {
  isolationRecorded: "workspace.isolation",
  bootstrapFailures: "workspace.provider_error",
  suspendFailures: "workspace.suspend_failed",
} as const;

export function summarizeWorkspaceSignals(types: string[]) {
  return summarizeWorkspaceSignalCounts(
    Object.entries(countByType(types)).map(([type, total]) => ({ type, total })),
  );
}

export function summarizeWorkspaceSignalCounts(rows: { type: string; total: number }[]) {
  const counts = new Map(rows.map((row) => [row.type, row.total]));
  return {
    isolationRecorded: counts.get(SIGNAL_TYPES.isolationRecorded) ?? 0,
    bootstrapFailures: counts.get(SIGNAL_TYPES.bootstrapFailures) ?? 0,
    suspendFailures: counts.get(SIGNAL_TYPES.suspendFailures) ?? 0,
  };
}

function countByType(types: string[]) {
  return types.reduce<Record<string, number>>((acc, type) => {
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
}

export function workspaceIsolationEvidence(
  provider: WorkspaceIsolationEvidence["provider"],
  actual?: {
    hostDockerSocketMounted: boolean;
    hostNetwork: boolean;
    privileged: boolean;
  },
): WorkspaceIsolationEvidence {
  if (provider === "docker") {
    const facts = actual ?? {
      hostDockerSocketMounted: false,
      hostNetwork: false,
      privileged: true,
    };
    const gaps = [
      ...(facts.privileged ? ["the container is privileged so nested dockerd can start"] : []),
      "every agent still has the project GitHub maintainer capability",
      "outbound network is not restricted",
    ];
    return {
      provider,
      ...facts,
      agentUser: "node",
      bootstrapUser: "root",
      network: "workspace",
      trust: "maintainer",
      gaps,
    };
  }
  if (provider === "vercel") {
    return {
      provider,
      hostDockerSocketMounted: false,
      hostNetwork: false,
      agentUser: "node",
      bootstrapUser: "root",
      privileged: false,
      network: "provider",
      trust: "maintainer",
      gaps: [
        "provider operators can access sandbox compute",
        "every agent still has the project GitHub maintainer capability",
        "outbound network is not restricted",
      ],
    };
  }
  return {
    provider,
    hostDockerSocketMounted: false,
    hostNetwork: false,
    agentUser: "unisolated",
    bootstrapUser: "unisolated",
    privileged: false,
    network: "none",
    trust: "maintainer",
    gaps: ["fake runtime never provides isolation"],
  };
}
