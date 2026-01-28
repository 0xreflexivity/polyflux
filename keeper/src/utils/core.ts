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
 * Build the jq transform for Polymarket market data
 *
 * Input from Polymarket API:
 * {
 *   "slug": "market-slug",
 *   "question": "Will X happen?",
 *   "outcomePrices": "[\"0.45\", \"0.55\"]",
 *   "volume24hr": 123456.78,
 *   "liquidityNum": 50000.00
 * }
 *
 * Output:
 * {
 *   "marketId": "market-slug",
 *   "question": "Will X happen?",
 *   "yesPrice": 4500,
 *   "noPrice": 5500,
 *   "volume": 123456780000,
 *   "liquidity": 50000000000
 * }
 */
export function buildPostProcessJq(): string {
    return `
        . |
        if type == "array" then .[0] else . end |
        {
            marketId: .slug,
            question: (.question | if length > 100 then .[:100] else . end),
            yesPrice: ((.outcomePrices | fromjson)[0] | tonumber * 10000 | floor),
            noPrice: ((.outcomePrices | fromjson)[1] | tonumber * 10000 | floor),
            volume: ((.volume24hr // 0) * 1000000 | floor),
            liquidity: ((.liquidityNum // 0) * 1000000 | floor)
        }
    `
        .replace(/\s+/g, " ")
        .trim();
}
