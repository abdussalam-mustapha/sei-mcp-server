/**
 * Get supported networks
 */
export async function getSupportedNetworks() {
  return {
    networks: [
      {
        name: 'sei',
        chainId: 'pacific-1',
        type: 'cosmos',
        rpcUrl: 'https://rpc.sei-apis.com',
        restUrl: 'https://rest.sei-apis.com'
      },
      {
        name: 'sei-testnet',
        chainId: 'atlantic-2',
        type: 'cosmos',
        rpcUrl: 'https://rpc-testnet.sei-apis.com',
        restUrl: 'https://rest-testnet.sei-apis.com'
      }
    ]
  };
}

/**
 * Get chain information for a network
 */
export async function getChainInfo(network: string = 'sei') {
  try {
    const networks = await getSupportedNetworks();
    const networkInfo = networks.networks.find(n => n.name === network);
    
    if (!networkInfo) {
      throw new Error(`Network ${network} not supported`);
    }

    return {
      chainId: networkInfo.chainId,
      chainName: networkInfo.name,
      rpcUrl: networkInfo.rpcUrl,
      restUrl: networkInfo.restUrl,
      type: networkInfo.type,
      status: 'active'
    };
  } catch (error) {
    console.error(`[NETWORK] Failed to get chain info for ${network}:`, error);
    throw error;
  }
}

/**
 * Get network status and information
 */
export async function getNetworkStatus(network: string = 'sei') {
  try {
    const networks = await getSupportedNetworks();
    const networkInfo = networks.networks.find(n => n.name === network);
    
    if (!networkInfo) {
      throw new Error(`Network ${network} not supported`);
    }

    return {
      network: networkInfo.name,
      chainId: networkInfo.chainId,
      status: 'active',
      blockHeight: Math.floor(Math.random() * 1000000) + 5000000, // Mock block height
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error(`[NETWORK] Failed to get network status for ${network}:`, error);
    throw error;
  }
}
