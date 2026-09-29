import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { loadPlugins } from "./plugin.js";

const config = readConfig();
const app = await buildApp(config, { plugins: await loadPlugins(config.pluginPaths ?? []) });
await app.listen({ port: config.port, host: "0.0.0.0" });
