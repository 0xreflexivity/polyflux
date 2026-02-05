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
 *   "yesPrice": 9000,  // Rounded to nearest 1000 bps (10%)
 *   "noPrice": 1000,
 *   "volume": 1000000,
 *   "liquidity": 1000000
 * }
 *
 * Note: CLOB API returns single object, not array.
 * Rounds prices to nearest 1000 bps (10%) to ensure DA layer consensus
 * even when different nodes query the API at slightly different times.
 */
export function buildPostProcessJq(): string {
    // Note: fromjson, tonumber, floor are NOT supported by the FDC verifier
    // Round to nearest 1000 bps (10%) for DA layer consensus:
    // Formula: (price * 10000 + 500) - ((price * 10000 + 500) % 1000)
    // This ensures slight price fluctuations don't break consensus
    return `{marketId: .market_slug, question: .question[0:100], yesPrice: ((.tokens[0].price * 10000 + 500) | . - (. % 1000)), noPrice: ((.tokens[1].price * 10000 + 500) | . - (. % 1000)), volume: 1000000, liquidity: 1000000}`;
}
