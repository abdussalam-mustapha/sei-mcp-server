import { config } from "dotenv";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import startServer from "./server.js";
import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Environment variables - hardcoded values
const PORT = 3004;
const HOST = '0.0.0.0';

console.error(`Configured to listen on ${HOST}:${PORT}`);

// Setup Express
const app = express();
app.use(express.json());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
  credentials: true,
  exposedHeaders: ['Content-Type', 'Access-Control-Allow-Origin']
}));

// Add OPTIONS handling for preflight requests
app.options('*', cors());

// Keep track of active connections with session IDs
const connections = new Map<string, SSEServerTransport>();

// Initialize the server
let server: McpServer | null = null;
startServer().then(s => {
  server = s;
  console.error("MCP Server initialized successfully");
}).catch(error => {
  console.error("Failed to initialize server:", error);
  process.exit(1);
});

// Define routes
// @ts-ignore
app.get("/sse", (req: Request, res: Response) => {
  console.error(`Received SSE connection request from ${req.ip}`);
  console.error(`Query parameters: ${JSON.stringify(req.query)}`);
  
  // Set CORS headers explicitly
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID');
  
  if (!server) {
    console.error("Server not initialized yet, rejecting SSE connection");
    return res.status(503).send("Server not initialized");
  }
  
  // Use the session ID provided by the client, or generate one if not provided
  // The sessionId is crucial for mapping SSE connections to message handlers
  let sessionId = req.query.sessionId?.toString();
  if (!sessionId) {
    sessionId = generateSessionId();
    console.error(`No sessionId provided, generating new one: ${sessionId}`);
  } else {
    console.error(`Using client-provided session ID: ${sessionId}`);
  }
  
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  
  // Create transport - handle before writing to response
  try {
    console.error(`Creating SSE transport for session: ${sessionId}`);
    
    // Create and store the transport keyed by session ID
    // Note: The path must match what the client expects (typically "/messages")
    const transport = new SSEServerTransport("/messages", res);
    connections.set(sessionId, transport);
    
    // Handle connection close
    req.on("close", () => {
      console.error(`SSE connection closed for session: ${sessionId}`);
      connections.delete(sessionId);
    });
    
    // Connect transport to server - this must happen before sending any data
    server.connect(transport).then(() => {
      // Send an initial event with the session ID for the client to use in messages
      // Only send this after the connection is established
      console.error(`SSE connection established for session: ${sessionId}`);
      
      // Send the session ID to the client
      res.write(`data: ${JSON.stringify({ type: "session_init", sessionId })}\n\n`);
    }).catch((error: Error) => {
      console.error(`Error connecting transport to server: ${error}`);
      connections.delete(sessionId);
    });
  } catch (error) {
    console.error(`Error creating SSE transport: ${error}`);
    connections.delete(sessionId);
    res.status(500).send(`Internal server error: ${error}`);
  }
});

// @ts-ignore
app.post("/messages", (req: Request, res: Response) => {
  // Extract the session ID from the URL query parameters
  let sessionId = req.query.sessionId?.toString();
  
  // If no sessionId is provided and there's only one connection, use that
  if (!sessionId && connections.size === 1) {
    sessionId = Array.from(connections.keys())[0];
    console.error(`No sessionId provided, using the only active session: ${sessionId}`);
  }
  
  console.error(`Received message for sessionId ${sessionId}`);
  console.error(`Message body: ${JSON.stringify(req.body)}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (!server) {
    console.error("Server not initialized yet");
    return res.status(503).json({ error: "Server not initialized" });
  }
  
  if (!sessionId) {
    console.error("No session ID provided and multiple connections exist");
    return res.status(400).json({ 
      error: "No session ID provided. Please provide a sessionId query parameter or connect to /sse first.",
      activeConnections: connections.size
    });
  }
  
  const transport = connections.get(sessionId);
  if (!transport) {
    console.error(`Session not found: ${sessionId}`);
    return res.status(404).json({ error: "Session not found" });
  }
  
  console.error(`Handling message for session: ${sessionId}`);
  try {
    transport.handlePostMessage(req, res).catch((error: Error) => {
      console.error(`Error handling post message: ${error}`);
      res.status(500).json({ error: `Internal server error: ${error.message}` });
    });
  } catch (error) {
    console.error(`Exception handling post message: ${error}`);
    res.status(500).json({ error: `Internal server error: ${error}` });
  }
});

// Add a simple health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ 
    status: "ok",
    server: server ? "initialized" : "initializing",
    activeConnections: connections.size,
    connectedSessionIds: Array.from(connections.keys())
  });
});

// Add MCP API endpoint for direct MCP requests
// @ts-ignore
app.post("/api/mcp", async (req: Request, res: Response) => {
  console.error(`Received MCP API request from ${req.ip}`);
  console.error(`Request body: ${JSON.stringify(req.body)}`);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-ID');
  
  if (!server) {
    console.error("Server not initialized yet");
    return res.status(503).json({ 
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32000, message: "Server not initialized" }
    });
  }
  
  try {
    const { jsonrpc, id, method, params } = req.body;
    
    if (jsonrpc !== '2.0') {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: "Invalid JSON-RPC version" }
      });
    }
    
    if (!method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32600, message: "Missing method" }
      });
    }
    
    console.error(`Processing MCP method: ${method}`);
    
    // For now, return a simple response indicating the method was received
    // TODO: Implement proper MCP method handling
    let result;
    
    switch (method) {
      case 'get_supported_networks':
        result = ['evm', 'native'];
        break;
      case 'get_balance':
        result = { amount: '0', denom: 'sei', formatted: '0 SEI' };
        break;
      case 'get_latest_block':
        try {
          // Import and use real blockchain service
          const { getLatestBlock } = await import('../core/services/blocks.js');
          const block = await getLatestBlock(params.network || 'sei');
          result = {
            number: Number(block.number),
            hash: block.hash,
            timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
            transactions: block.transactions || [],
            gasUsed: block.gasUsed?.toString() || '0',
            gasLimit: block.gasLimit?.toString() || '0',
            network: params.network || 'sei'
          };
        } catch (error) {
          console.error('Error fetching latest block:', error);
          result = { error: 'Failed to fetch latest block', message: error instanceof Error ? error.message : 'Unknown error' };
        }
        break;
      case 'get_transaction':
        try {
          if (!params.hash) {
            result = { error: 'Transaction hash is required' };
            break;
          }
          // Import and use real blockchain service
          const { getTransaction, getTransactionReceipt } = await import('../core/services/transactions.js');
          const tx = await getTransaction(params.hash, params.network || 'sei');
          let receipt;
          try {
            receipt = await getTransactionReceipt(params.hash, params.network || 'sei');
          } catch (receiptError) {
            console.warn('Could not fetch transaction receipt:', receiptError instanceof Error ? receiptError.message : 'Unknown error');
          }
          
          result = {
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value?.toString() || '0',
            gasUsed: receipt?.gasUsed?.toString() || tx.gas?.toString() || '0',
            gasPrice: tx.gasPrice?.toString() || '0',
            blockNumber: Number(tx.blockNumber || 0),
            timestamp: tx.blockNumber ? new Date().toISOString() : new Date().toISOString(), // Would need block timestamp
            status: receipt?.status === 'success' ? 'success' : 'failed',
            network: params.network || 'sei'
          };
        } catch (error) {
          console.error('Error fetching transaction:', error);
          result = { error: 'Failed to fetch transaction', message: error instanceof Error ? error.message : 'Unknown error' };
        }
        break;
      default:
        result = { message: `Method ${method} received but not yet implemented` };
    }
    
    const response = {
      jsonrpc: '2.0',
      id,
      result
    };
    
    console.error(`MCP response: ${JSON.stringify(response)}`);
    res.json(response);
    
  } catch (error) {
    console.error(`Error processing MCP request: ${error}`);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { 
        code: -32603, 
        message: "Internal error",
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    });
  }
});

// Add a root endpoint for basic info
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    name: "MCP Server",
    version: "1.0.0",
    endpoints: {
      sse: "/sse",
      messages: "/messages",
      health: "/health",
      api: "/api/mcp"
    },
    status: server ? "ready" : "initializing",
    activeConnections: connections.size
  });
});

// Helper function to generate a UUID-like session ID
function generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.error('Shutting down server...');
  connections.forEach((transport, sessionId) => {
    console.error(`Closing connection for session: ${sessionId}`);
  });
  process.exit(0);
});

// Start the HTTP server on a different port (3001) to avoid conflicts
const httpServer = app.listen(PORT, HOST, () => {
  console.error(`Template MCP Server running at http://${HOST}:${PORT}`);
  console.error(`SSE endpoint: http://${HOST}:${PORT}/sse`);
  console.error(`Messages endpoint: http://${HOST}:${PORT}/messages (sessionId optional if only one connection)`);
  console.error(`Health check: http://${HOST}:${PORT}/health`);
}).on('error', (err: Error) => {
  console.error(`Server error: ${err}`);
}); 