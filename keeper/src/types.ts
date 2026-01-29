/**
 * Type definitions for the POLYFLUX keeper
 */

export interface Config {
    // Network
    rpcUrl: string;
    privateKey: string;
    oracleAddress: string;

    // FDC Endpoints
    web2JsonVerifierUrl: string;
    daLayerUrl: string;
    verifierApiKey: string;

    // FDC Attestation Config
    attestationType: string;
    sourceId: string;

    // Polymarket
    polymarketApi: string;

    // Timing
    updateIntervalMs: number;
    maxStalenessSeconds: number;
    maxMarketsPerCycle: number;
}

export interface MarketData {
    slug: string;
    question: string;
    yesPrice: number;
    noPrice: number;
    volume: number;
    liquidity: number;
}

export interface PolymarketApiMarket {
    condition_id: string;
    market_slug: string;
    question: string;
    tokens: Array<{
        token_id: string;
        outcome: string;
        price: number;
        winner: boolean;
    }>;
    active: boolean;
    closed: boolean;
    // Legacy fields for gamma API compatibility
    slug?: string;
    outcomePrices?: string;
    volume24hr?: number;
    volumeNum?: number;
    liquidityNum?: number;
}

export interface ClobApiResponse {
    count: number;
    data: PolymarketApiMarket[];
    limit: number;
    next_cursor: string;
}

export interface AttestationProof {
    proof: string[];
    response_hex: string;
}

// ABI signature for the MarketDTO struct
export const MARKET_DTO_ABI_SIGNATURE = JSON.stringify({
    components: [
        { internalType: "string", name: "marketId", type: "string" },
        { internalType: "string", name: "question", type: "string" },
        { internalType: "uint256", name: "yesPrice", type: "uint256" },
        { internalType: "uint256", name: "noPrice", type: "uint256" },
        { internalType: "uint256", name: "volume", type: "uint256" },
        { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    name: "MarketDTO",
    type: "tuple",
});
