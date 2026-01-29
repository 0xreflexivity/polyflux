/**
 * Core utility functions for the POLYFLUX keeper
 */

export function toHex(data: string): string {
    let result = "";
    for (let i = 0; i < data.length; i++) {
        result += data.charCodeAt(i).toString(16);
    }
    return result.padEnd(64, "0");
}

export function toUtf8HexString(data: string): string {
    return "0x" + toHex(data);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the jq transform for Polymarket CLOB API market data
 *
 * Input from CLOB API (single market by condition_id):
 * {
 *   "market_slug": "market-slug",
 *   "question": "Will X happen?",
 *   "tokens": [
 *     {"outcome": "Yes", "price": 0.89},
 *     {"outcome": "No", "price": 0.11}
 *   ]
 * }
 *
 * Output:
 * {
 *   "marketId": "market-slug",
 *   "question": "Will X happen?",
 *   "yesPrice": 8900,
 *   "noPrice": 1100,
 *   "volume": 1000000,
 *   "liquidity": 1000000
 * }
 *
 * Note: CLOB API returns single object, not array.
 * Uses | . - (. % 1) to truncate decimals (floor not supported).
 */
export function buildPostProcessJq(): string {
    // Note: fromjson, tonumber, floor are NOT supported by the FDC verifier
    // Use | . - (. % 1) to truncate decimals
    return `{marketId: .market_slug, question: .question[0:100], yesPrice: (.tokens[0].price * 10000 | . - (. % 1)), noPrice: (.tokens[1].price * 10000 | . - (. % 1)), volume: 1000000, liquidity: 1000000}`;
}
