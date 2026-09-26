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
  if (
    sources.some((source) => source === "/var/run/docker.sock" || source.endsWith("/docker.sock"))
  ) {
    throw new Error("host docker socket must not be mounted into a story workspace");
  }
  if (hostConfig.NetworkMode === "host") {
    throw new Error("story workspace must not join the host network");
  }
}

export function assertNoHostDockerSocket(hostConfig: { Binds?: string[]; Mounts?: HostMount[] }) {
  assertWorkspaceHostBoundary(hostConfig);
}

export function workspaceIsolationEvidence(
  provider: WorkspaceIsolationEvidence["provider"],
): WorkspaceIsolationEvidence {
  if (provider === "docker") {
    return {
      provider,
      hostDockerSocketMounted: false,
      hostNetwork: false,
      agentUser: "node",
      bootstrapUser: "root",
      privileged: true,
      network: "workspace",
      trust: "maintainer",
      gaps: [
        "the container is privileged so nested dockerd can start",
        "every agent still has the project GitHub maintainer capability",
        "outbound network is not restricted",
      ],
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
