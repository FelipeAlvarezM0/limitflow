import "dotenv/config";
import { loadConfig } from "@quotaguard/shared";
import { buildApp } from "./app.js";
import { initTelemetry } from "./telemetry/init.js";

const config = loadConfig();
const shutdownTelemetry = await initTelemetry(config);
const { app, close } = await buildApp(config);

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, "Graceful shutdown started");

  try {
    await close();
    await shutdownTelemetry();
    app.log.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Graceful shutdown failed");
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({
    host: "0.0.0.0",
    port: config.PORT
  });
} catch (error) {
  app.log.error({ err: error }, "Failed to start server");
  await shutdownTelemetry();
  process.exit(1);
}
