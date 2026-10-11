import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initFirebase, getDb, resetTarget } from "./firebase.js";
import {
  getToolDefinitions,
  getHandler,
  getReadOnlyMode,
  WRITE_TOOLS,
} from "./tools/index.js";
import { buildResponse, buildErrorResponse } from "./helpers/response.js";
import { isAuthError } from "./helpers/errors.js";
import { checkUnknownArgs } from "./helpers/args.js";
import { TARGETS } from "./constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

/** Connection test timeout in milliseconds. */
const CONNECTION_TEST_TIMEOUT_MS = 10_000;

/**
 * Test a single Firestore connection with a timeout.
 */
async function testConnection(target) {
  const { db } = getDb(target);
  const testQuery = db.collection("_test_connection").limit(1).get();
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("Connection test timed out")),
      CONNECTION_TEST_TIMEOUT_MS,
    ),
  );
  await Promise.race([testQuery, timeout]);
}

/**
 * Execute one tool call: validate, enforce read-only mode, run the handler,
 * and on an auth-class failure reset that target's credentials and retry once.
 *
 * @param {string} name
 * @param {object} args
 * @param {{toolDefinitions: object[], getDb?: Function, getHandler?: Function, resetTarget?: Function}} deps
 */
export async function handleToolCall(name, args, deps) {
  const lookupDb = deps.getDb ?? getDb;
  const lookupHandler = deps.getHandler ?? getHandler;
  const reset = deps.resetTarget ?? resetTarget;
  args = args ?? {};

  try {
    const handler = lookupHandler(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);

    const readOnly = getReadOnlyMode();
    const isWrite = WRITE_TOOLS.includes(name);
    if (isWrite && readOnly === "all") {
      throw new Error(
        `${name} is disabled: server is in read-only mode (MCP_FIRESTORE_READONLY). Use a read tool instead.`,
      );
    }

    const definition = deps.toolDefinitions?.find(d => d.name === name);
    if (definition) {
      const problem = checkUnknownArgs(name, args, definition.inputSchema);
      if (problem) throw new Error(problem);
    }

    let { db, target } = lookupDb(args.target);
    if (isWrite && readOnly === "production" && target === TARGETS.PRODUCTION) {
      throw new Error(
        `${name} on the production target is disabled (MCP_FIRESTORE_READONLY=production). Use target "emulator" or a read tool.`,
      );
    }

    let result;
    try {
      result = await handler(args, db, target);
    } catch (error) {
      if (!isAuthError(error)) throw error;
      console.error(
        `[${target}] Auth error, re-initialising credentials and retrying once`,
      );
      await reset(target);
      ({ db } = lookupDb(target));
      result = await handler(args, db, target);
    }

    return buildResponse({ ...result, target });
  } catch (error) {
    console.error("Tool execution error:", error);
    return buildErrorResponse(error);
  }
}

export async function startServer() {
  try {
    console.error("Starting Firestore MCP Server...");

    // Initialize Firebase with dual-endpoint support
    const { defaultTarget, availableTargets } = initFirebase();

    // Test connections in parallel with timeout
    await Promise.allSettled(
      availableTargets.map(async target => {
        try {
          await testConnection(target);
          console.error(`[${target}] Connection verified`);
        } catch (error) {
          console.error(`[${target}] Connection test failed: ${error.message}`);
          if (target === "emulator") {
            console.error(
              `Make sure the Firestore emulator is running on ${process.env.FIRESTORE_EMULATOR_HOST}`,
            );
          }
        }
      }),
    );

    // Cache tool definitions (immutable after init)
    const toolDefinitions = getToolDefinitions(availableTargets, defaultTarget);

    const server = new Server(
      {
        name: "firestore-mcp-server",
        version: pkg.version,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    console.error("MCP Server instance created");

    // Register tool definitions (cached, not rebuilt per request)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefinitions,
    }));

    console.error("Tools registered");

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;
      console.error(`Tool called: ${name}`);

      return handleToolCall(name, args, { toolDefinitions });
    });

    console.error("Request handlers set up");

    // Create transport
    const transport = new StdioServerTransport();
    console.error("Transport created, connecting...");

    transport.onclose = () => {
      console.error("Transport closed");
    };

    transport.onerror = error => {
      console.error("Transport error:", error);
    };

    await server.connect(transport);
    console.error("Firestore MCP Server started successfully and connected");

    // Keep the process alive
    process.stdin.resume();
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}
