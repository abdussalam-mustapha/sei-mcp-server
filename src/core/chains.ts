import { type Chain } from 'viem';
import {
  sei,
  seiTestnet,
  seiDevnet
} from 'viem/chains';

// Default configuration values
export const DEFAULT_NETWORK = 'sei';
export const DEFAULT_RPC_URL = 'https://evm-rpc.sei-apis.com';
export const DEFAULT_CHAIN_ID = 1329;

// SEI RPC endpoint pools for load balancing and fallback
export const SEI_RPC_ENDPOINTS = {
  mainnet: [
    'https://evm-rpc.sei-apis.com',
    'https://sei-evm-rpc.stakeme.pro',
    'https://node.histori.xyz/sei-mainnet/8ry9f6t9dct1se2hlagxnd9n2a',
    'https://sei.drpc.org'
  ],
  testnet: [
    'https://evm-rpc-testnet.sei-apis.com'
  ],
  devnet: [
    'https://evm-rpc-arctic-1.sei-apis.com'
  ]
};

// WebSocket endpoints for real-time data
export const SEI_WS_ENDPOINTS = {
  mainnet: [
    'wss://evm-ws.sei-apis.com',
    'wss://sei.drpc.org'
  ],
  testnet: [
    'wss://evm-ws-testnet.sei-apis.com'
  ],
  devnet: [
    'wss://evm-ws-arctic-1.sei-apis.com'
  ]
};

// Map chain IDs to chains
export const chainMap: Record<number, Chain> = {
  1329: sei,
  1328: seiTestnet,
  713_715: seiDevnet
};

// Map network names to chain IDs for easier reference
export const networkNameMap: Record<string, number> = {
  'sei': 1329,
  'sei-testnet': 1328,
  'sei-devnet': 713_715,
};

// Map chain IDs to RPC URLs (using primary endpoints)
export const rpcUrlMap: Record<number, string> = {
  1329: SEI_RPC_ENDPOINTS.mainnet[0], // Primary mainnet endpoint
  1328: SEI_RPC_ENDPOINTS.testnet[0], // Primary testnet endpoint
  713_715: SEI_RPC_ENDPOINTS.devnet[0] // Primary devnet endpoint
};

// Map chain IDs to all available RPC URLs for fallback
export const rpcUrlPoolMap: Record<number, string[]> = {
  1329: SEI_RPC_ENDPOINTS.mainnet,
  1328: SEI_RPC_ENDPOINTS.testnet,
  713_715: SEI_RPC_ENDPOINTS.devnet
};

/**
 * Resolves a chain identifier (number or string) to a chain ID
 * @param chainIdentifier Chain ID (number) or network name (string)
 * @returns The resolved chain ID
 */
export function resolveChainId(chainIdentifier: number | string): number {
  if (typeof chainIdentifier === 'number') {
    return chainIdentifier;
  }

  // Convert to lowercase for case-insensitive matching
  const networkName = chainIdentifier.toLowerCase();

  // Check if the network name is in our map
  if (networkName in networkNameMap) {
    return networkNameMap[networkName];
  }

  // Try parsing as a number
  const parsedId = parseInt(networkName);
  if (!isNaN(parsedId)) {
    return parsedId;
  }

  // Default to mainnet if not found
  return DEFAULT_CHAIN_ID;
}

/**
 * Returns the chain configuration for the specified chain ID or network name
 * @param chainIdentifier Chain ID (number) or network name (string)
 * @returns The chain configuration
 * @throws Error if the network is not supported (when string is provided)
 */
export function getChain(chainIdentifier: number | string = DEFAULT_CHAIN_ID): Chain {
  if (typeof chainIdentifier === 'string') {
    const networkName = chainIdentifier.toLowerCase();
    // Try to get from direct network name mapping first
    if (networkNameMap[networkName]) {
      return chainMap[networkNameMap[networkName]] || sei;
    }

    // If not found, throw an error
    throw new Error(`Unsupported network: ${chainIdentifier}`);
  }

  // If it's a number, return the chain from chainMap
  return chainMap[chainIdentifier] || sei;
}

/**
 * Gets the appropriate RPC URL for the specified chain ID or network name
 * @param chainIdentifier Chain ID (number) or network name (string)
 * @returns The RPC URL for the specified chain
 */
export function getRpcUrl(chainIdentifier: number | string = DEFAULT_CHAIN_ID): string {
  const chainId = typeof chainIdentifier === 'string'
    ? resolveChainId(chainIdentifier)
    : chainIdentifier;

  return rpcUrlMap[chainId] || DEFAULT_RPC_URL;
}

/**
 * Get a list of supported networks
 * @returns Array of supported network names (excluding short aliases)
 */
export function getSupportedNetworks(): string[] {
  return Object.keys(networkNameMap).filter(name => !name.includes('-'));
}

/**
 * Get all available RPC URLs for a chain (for failover)
 * @param chainIdentifier Chain ID (number) or network name (string)
 * @returns Array of RPC URLs for the specified chain
 */
export function getRpcUrlPool(chainIdentifier: number | string = DEFAULT_CHAIN_ID): string[] {
  const chainId = resolveChainId(chainIdentifier);
  return rpcUrlPoolMap[chainId] || [DEFAULT_RPC_URL];
}

/**
 * Get WebSocket endpoint for a chain
 * @param chainIdentifier Chain ID (number) or network name (string)
 * @returns WebSocket URL for the specified chain
 */
export function getWebSocketUrl(chainIdentifier: number | string = DEFAULT_CHAIN_ID): string {
  const chainId = resolveChainId(chainIdentifier);
  const endpoints = chainId === 1329 ? SEI_WS_ENDPOINTS.mainnet :
                   chainId === 1328 ? SEI_WS_ENDPOINTS.testnet :
                   chainId === 713_715 ? SEI_WS_ENDPOINTS.devnet :
                   SEI_WS_ENDPOINTS.mainnet;
  return endpoints[0]; // Return primary WebSocket endpoint
}

/**
 * Get all available WebSocket URLs for a chain (for failover)
 * @param chainIdentifier Chain ID (number) or network name (string)
 * @returns Array of WebSocket URLs for the specified chain
 */
export function getWebSocketUrlPool(chainIdentifier: number | string = DEFAULT_CHAIN_ID): string[] {
  const chainId = resolveChainId(chainIdentifier);
  return chainId === 1329 ? SEI_WS_ENDPOINTS.mainnet :
         chainId === 1328 ? SEI_WS_ENDPOINTS.testnet :
         chainId === 713_715 ? SEI_WS_ENDPOINTS.devnet :
         SEI_WS_ENDPOINTS.mainnet;
}
