#!/usr/bin/env node

import { startServer } from "./src/server.js";

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.error(`Received ${signal}, shutting down Firestore MCP Server.`);
    process.exit(0);
  });
}

startServer();
