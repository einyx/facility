---
title: Engine plugins
---

# Engine plugins

Facility ships two agent engines, `claude_code` and `codex`. Operators can add more engines
with plugins, without forking Facility. A plugin tells Facility which command-line program
to run inside the story workspace and how to read its JSONL output. Facility still handles
process supervision, streaming, cancellation, timeouts, redaction and error reporting, the
same way it does for the built-in engines.

Plugins are ordinary JavaScript modules that run inside the API and worker processes with
their full privileges. Only install plugins you trust.

## Configure

Set `FACILITY_PLUGINS` on **both** the API and the worker to a comma-separated list of
module specifiers: absolute paths, `./relative` paths, or installed package names.

```bash
FACILITY_PLUGINS=/opt/facility/plugins/my-engine.mjs,@acme/facility-engine
```

Facility loads every plugin at startup and refuses to start if one fails to import or does
not satisfy the contract below. The error names the plugin.

## Contract

A plugin's default export is a `FacilityPlugin`. The types are exported from `@facility/api`.

```js
/** @type {import("@facility/api").FacilityPlugin} */
export default {
  apiVersion: 1,
  name: "my-engine",
  engines: {
    my_engine: {
      // Program inside the workspace image. It must print one JSON object per line on stdout.
      command: "my-engine-cli",
      args: ({ prompt, model, nativeSessionId, options }) => [
        "--json",
        "--model",
        model,
        ...(nativeSessionId ? ["--resume", nativeSessionId] : []),
        prompt,
      ],
      // Called once per turn; keep per-turn state inside the returned object.
      parser: () => {
        let sessionId;
        let output = "";
        return {
          accept(event) {
            if (event.type === "session") sessionId = event.id;
            if (event.type === "final") output = event.text;
            return [{ engine: "my_engine", type: event.type, data: event }];
          },
          result: () => ({ sessionId, output, progress: [], events: [] }),
        };
      },
    },
  },
};
```

- `apiVersion` must be `1`. Facility rejects plugins written for a contract it does not
  support.
- Engine names use the pattern `^[a-z][a-z0-9_]{0,63}$`, and agent manifests refer to them
  in `engine:`. A plugin engine cannot reuse a built-in name or another plugin's name.
- `accept` receives each parsed JSONL object and returns the events to record and stream.
  Facility sets each event's `engine` field to the engine name.
- `result()` has to report a `sessionId`, or the turn fails with `agent_session_missing`.
  A non-zero exit fails with `agent_engine_failed`, and output that isn't JSONL fails the turn.
- The engine stores its state under `/workspace/.facility/<engine>`.

The command has to be installed in the workspace image (`FACILITY_WORKSPACE_IMAGE`).

## Use it in an agent

```markdown
---
name: reviewer
description: Reviews pull requests.
engine: my_engine
model: my-model-1
triggers:
  - type: manual
---
Review the change.
```

A manifest that names an engine no loaded plugin provides still parses, but its turns fail
with `agent_engine_unavailable`.
