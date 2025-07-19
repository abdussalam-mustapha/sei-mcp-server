import { getBalance as getBalanceService } from './balance.js';

/**
 * Get wallet balance for a given address
 */
export async function getBalance(address: string, network: string = 'sei') {
  return await getBalanceService(address, network);
}

/**
 * Analyze wallet activity and holdings
 */
export async function analyzeWallet(address: string, network: string = 'sei') {
  try {
    const balance = await getBalance(address, network);
    
    return {
      address,
      network,
      balance,
      analysis: {
        totalValue: balance.sei || '0',
        riskScore: 'low',
        lastActivity: new Date().toISOString(),
        transactionCount: 0
      }
    };
  } catch (error) {
    console.error(`[WALLET] Failed to analyze wallet ${address}:`, error);
    throw error;
  }
}
