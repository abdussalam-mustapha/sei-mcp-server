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

// Add JSON-RPC endpoint for direct tool calls
app.post("/api/mcp", async (req: Request, res: Response): Promise<void> => {
  console.error(`Received JSON-RPC request to /api/mcp: ${JSON.stringify(req.body)}`);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (!server) {
    console.error("Server not initialized yet");
    res.status(503).json({ 
      jsonrpc: "2.0", 
      id: req.body.id, 
      error: { code: -32002, message: "Server not initialized" } 
    });
    return;
  }

  try {
    const { method, params, id } = req.body;
    console.error(`Processing JSON-RPC method: ${method} with params:`, params);

    // Call service methods directly since MCP Server doesn't expose callTool
    let result;
    
    switch (method) {
      case 'get_balance': {
        // For sei1 addresses, try Sei REST API first before falling back to EVM
        if (params.address.startsWith('sei1')) {
          try {
            // Try multiple API endpoints for better accuracy
            let response, data;
            let apiError = null;
            
            try {
              console.log(`[BALANCE] Trying primary REST API for ${params.address}`);
              response = await fetch(`https://rest.sei-apis.com/cosmos/bank/v1beta1/balances/${params.address}`);
              
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
              }
              
              data = await response.json();
              console.log(`[BALANCE] Primary API response:`, data);
            } catch (primaryError: unknown) {
              const errorMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
              console.log(`[BALANCE] Primary API failed: ${errorMessage}`);
              apiError = primaryError;
              
              // Try fallback API
              try {
                console.log(`[BALANCE] Trying fallback REST API for ${params.address}`);
                response = await fetch(`https://sei-api.polkachu.com/cosmos/bank/v1beta1/balances/${params.address}`);
                
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                data = await response.json();
                console.log(`[BALANCE] Fallback API response:`, data);
              } catch (fallbackError: unknown) {
                const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                console.log(`[BALANCE] Fallback API also failed: ${fallbackErrorMessage}`);
                throw apiError; // Throw the original error
              }
            }
            
            if (data && data.balances) {
              result = {
                address: params.address,
                balances: data.balances,
                network: params.network || 'sei'
              };
            } else {
              throw new Error('Invalid response format from REST API');
            }
          } catch (restError: unknown) {
            const restErrorMessage = restError instanceof Error ? restError.message : String(restError);
            console.log(`[BALANCE] REST API failed for ${params.address}: ${restErrorMessage}`);
            // Fall back to EVM method for sei1 addresses
            const { getBalance } = await import('../core/services/wallet.js');
            result = await getBalance(params.address, params.network || 'sei');
          }
        } else {
          // For EVM addresses, use the wallet service directly
          const { getBalance } = await import('../core/services/wallet.js');
          result = await getBalance(params.address, params.network || 'sei');
        }
        break;
      }
      
      case 'get_transaction': {
        const { getTransaction } = await import('../core/services/transactions.js');
        result = await getTransaction(params.hash, params.network || 'sei');
        break;
      }
      
      case 'get_transaction_receipt': {
        const { getTransactionReceipt } = await import('../core/services/transactions.js');
        result = await getTransactionReceipt(params.hash, params.network || 'sei');
        break;
      }
      
      case 'get_latest_block': {
        const { getLatestBlock } = await import('../core/services/blocks.js');
        const block = await getLatestBlock(params.network || 'sei');
        result = block;
        break;
      }
      
      case 'get_block_by_number': {
        const { getBlockByNumber } = await import('../core/services/blocks.js');
        result = await getBlockByNumber(params.blockNumber, params.network || 'sei');
        break;
      }
      
      case 'get_chain_info': {
        const { getChainInfo } = await import('../core/services/network.js');
        result = await getChainInfo(params.network || 'sei');
        break;
      }
      
      case 'get_supported_networks': {
        const { getSupportedNetworks } = await import('../core/services/network.js');
        result = await getSupportedNetworks();
        break;
      }
      
      case 'estimate_gas': {
        const { estimateGas } = await import('../core/services/transactions.js');
        const gasParams = {
          to: params.to,
          data: params.data || '0x',
          value: BigInt(params.value || '0')
        };
        result = await estimateGas(gasParams, params.network || 'sei');
        break;
      }
      
      case 'get_erc20_balance': {
        const { getERC20Balance } = await import('../core/services/tokens.js');
        result = await getERC20Balance(
          params.tokenAddress,
          params.address,
          params.network || 'sei'
        );
        break;
      }
      
      case 'get_erc20_token_info': {
        const { getERC20TokenInfo } = await import('../core/services/tokens.js');
        result = await getERC20TokenInfo(params.tokenAddress, params.network || 'sei');
        break;
      }
      
      case 'get_erc721_token_metadata': {
        const { getERC721TokenMetadata } = await import('../core/services/nfts.js');
        result = await getERC721TokenMetadata(
          params.tokenAddress,
          params.tokenId,
          params.network || 'sei'
        );
        break;
      }
      
      case 'get_erc1155_token_uri': {
        const { getERC1155TokenURI } = await import('../core/services/nfts.js');
        result = await getERC1155TokenURI(
          params.tokenAddress,
          params.tokenId,
          params.network || 'sei'
        );
        break;
      }
      
      case 'check_nft_ownership': {
        const { checkNFTOwnership } = await import('../core/services/nfts.js');
        result = await checkNFTOwnership(
          params.tokenAddress,
          params.tokenId,
          params.ownerAddress,
          params.network || 'sei'
        );
        break;
      }
      
      case 'get_nft_balance': {
        const { getNFTBalance } = await import('../core/services/nfts.js');
        result = await getNFTBalance(
          params.tokenAddress,
          params.ownerAddress,
          params.network || 'sei'
        );
        break;
      }
      
      case 'get_erc1155_balance': {
        const { getERC1155Balance } = await import('../core/services/nfts.js');
        result = await getERC1155Balance(
          params.tokenAddress,
          params.tokenId,
          params.ownerAddress,
          params.network || 'sei'
        );
        break;
      }
      
      case 'is_contract': {
        const { isContract } = await import('../core/services/contracts.js');
        result = await isContract(params.address, params.network || 'sei');
        break;
      }
      
      case 'read_contract': {
        const { readContract } = await import('../core/services/contracts.js');
        const parsedAbi = typeof params.abi === 'string' ? JSON.parse(params.abi) : params.abi;
        const contractParams = {
          address: params.contractAddress,
          abi: parsedAbi,
          functionName: params.functionName,
          args: params.args || [],
          network: params.network || 'sei'
        };
        result = await readContract(contractParams);
        break;
      }
      
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    console.error(`Method ${method} completed successfully:`, result);
    
    // Convert BigInt values to strings for JSON serialization
    const serializedResult = JSON.parse(JSON.stringify(result, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
    
    res.json({
      jsonrpc: "2.0",
      id,
      result: serializedResult
    });
    
  } catch (error) {
    console.error(`Method ${req.body.method} failed:`, error);
    res.json({
      jsonrpc: "2.0",
      id: req.body.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error'
      }
    });
  }
});

// Health check endpoint for MCP client compatibility
app.get("/health", (req: Request, res: Response): void => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server: 'SEI MCP Server',
    version: '1.0.0',
    uptime: process.uptime(),
    endpoints: {
      sse: '/sse',
      mcp: '/api/mcp',
      health: '/health'
    },
    serverInitialized: server !== null
  };
  
  console.error(`Health check requested: ${JSON.stringify(healthStatus)}`);
  res.status(200).json(healthStatus);
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

// Add a root endpoint for basic info
app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    name: "MCP Server",
    version: "1.0.0",
    endpoints: {
      sse: "/sse",
      messages: "/messages",
      health: "/health"
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