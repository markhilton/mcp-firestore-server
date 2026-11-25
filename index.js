#!/usr/bin/env node

import { startServer, logError } from "./src/server.js";

process.on("uncaughtException", error => {
  logError("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", reason => {
  logError("Unhandled Rejection, reason:", reason);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.error(`Received ${signal}, shutting down Firestore MCP Server.`);
    process.exit(0);
  });
}

startServer();
