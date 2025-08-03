#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import admin from "firebase-admin";

// Add process error handlers
process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

async function startServer() {
  try {
    console.error("Starting Firestore MCP Server...");

    // Initialize Firebase Admin
    console.error("Initializing Firebase Admin...");

    // Get configuration from environment variables
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
    const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

    if (!projectId) {
      console.error("Error: GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID environment variable must be set");
      process.exit(1);
    }

    console.error(`Project ID: ${projectId}`);
    if (emulatorHost) {
      console.error(`Firestore emulator host: ${emulatorHost}`);
    } else {
      console.error("Connecting to production Firestore");
    }

    const app = admin.initializeApp({
      projectId: projectId,
    });

    const db = admin.firestore(app);
    console.error("Firestore instance created");

    // Test connection
    try {
      const testCollection = db.collection("_test_connection");
      await testCollection.limit(1).get();
      console.error("Successfully connected to Firestore");
    } catch (error) {
      console.error("Failed to connect to Firestore:", error.message);
      if (emulatorHost) {
        console.error(`Make sure the Firestore emulator is running on ${emulatorHost}`);
      }
      process.exit(1);
    }

    const server = new Server(
      {
        name: "firestore-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    console.error("MCP Server instance created");

    // Define tools
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "query_collection",
          description: "Query a Firestore collection",
          inputSchema: {
            type: "object",
            properties: {
              collection: { type: "string" },
              limit: { type: "number", default: 10 },
              orderBy: { type: "string" },
              orderDirection: { type: "string", enum: ["asc", "desc"], default: "asc" },
            },
            required: ["collection"],
          },
        },
        {
          name: "get_document",
          description: "Get a specific document by ID",
          inputSchema: {
            type: "object",
            properties: {
              collection: { type: "string" },
              docId: { type: "string" },
            },
            required: ["collection", "docId"],
          },
        },
        {
          name: "query_with_where",
          description: "Query a collection with where conditions",
          inputSchema: {
            type: "object",
            properties: {
              collection: { type: "string" },
              field: { type: "string" },
              operator: {
                type: "string",
                enum: ["==", "!=", "<", "<=", ">", ">=", "array-contains", "in", "array-contains-any"],
              },
              value: { type: "string" },
              limit: { type: "number", default: 10 },
            },
            required: ["collection", "field", "operator", "value"],
          },
        },
        {
          name: "list_collections",
          description: "List all top-level collections",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "create_document",
          description: "Create a new document in a collection",
          inputSchema: {
            type: "object",
            properties: {
              collection: { type: "string" },
              docId: { type: "string", description: "Optional document ID. If not provided, Firestore will auto-generate one" },
              data: { type: "object", description: "Document data as JSON object" },
            },
            required: ["collection", "data"],
          },
        },
        {
          name: "update_document",
          description: "Update an existing document",
          inputSchema: {
            type: "object",
            properties: {
              collection: { type: "string" },
              docId: { type: "string" },
              data: { type: "object", description: "Fields to update as JSON object" },
              merge: { type: "boolean", default: true, description: "Whether to merge with existing data" },
            },
            required: ["collection", "docId", "data"],
          },
        },
        {
          name: "delete_document",
          description: "Delete a document",
          inputSchema: {
            type: "object",
            properties: {
              collection: { type: "string" },
              docId: { type: "string" },
            },
            required: ["collection", "docId"],
          },
        },
      ],
    }));

    console.error("Tools registered");

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params;
      console.error(`Tool called: ${name} with args:`, args);

      try {
        switch (name) {
          case "query_collection": {
            let query = db.collection(args.collection);

            if (args.orderBy) {
              query = query.orderBy(args.orderBy, args.orderDirection || "asc");
            }

            const snapshot = await query.limit(args.limit || 10).get();

            const docs = snapshot.docs.map(doc => ({
              id: doc.id,
              data: doc.data(),
            }));

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      collection: args.collection,
                      count: docs.length,
                      documents: docs,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "get_document": {
            const doc = await db.collection(args.collection).doc(args.docId).get();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      id: doc.id,
                      exists: doc.exists,
                      data: doc.exists ? doc.data() : null,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "query_with_where": {
            const snapshot = await db
              .collection(args.collection)
              .where(args.field, args.operator, args.value)
              .limit(args.limit || 10)
              .get();

            const docs = snapshot.docs.map(doc => ({
              id: doc.id,
              data: doc.data(),
            }));

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      collection: args.collection,
                      query: `${args.field} ${args.operator} ${args.value}`,
                      count: docs.length,
                      documents: docs,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "list_collections": {
            const collections = await db.listCollections();
            const collectionNames = collections.map(col => col.id);

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      collections: collectionNames,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "create_document": {
            const collectionRef = db.collection(args.collection);
            let docRef;
            
            if (args.docId) {
              docRef = collectionRef.doc(args.docId);
              await docRef.set(args.data);
            } else {
              docRef = await collectionRef.add(args.data);
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      collection: args.collection,
                      id: docRef.id,
                      operation: "created",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "update_document": {
            const docRef = db.collection(args.collection).doc(args.docId);
            
            if (args.merge) {
              await docRef.set(args.data, { merge: true });
            } else {
              await docRef.update(args.data);
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      collection: args.collection,
                      id: args.docId,
                      operation: "updated",
                      merge: args.merge,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          case "delete_document": {
            await db.collection(args.collection).doc(args.docId).delete();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      collection: args.collection,
                      id: args.docId,
                      operation: "deleted",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        console.error("Tool execution error:", error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: error.message,
                  stack: error.stack,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    });

    console.error("Request handlers set up");

    // Create transport
    const transport = new StdioServerTransport();
    console.error("Transport created, connecting...");

    // Add transport error handlers
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
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();