import { web3 } from "hardhat";

const PredictionMarketOracle = artifacts.require("PredictionMarketOracle");

// Oracle contract address on Coston2 (update via env)
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || "0x5d3e91190AB802470C86c5f43a85ebDAEDE7131f";

interface PolymarketMarket {
    slug: string;
    question: string;
    outcomePrices: string;
    volumeNum: number;
    liquidityNum: number;
    active: boolean;
    closed: boolean;
}

async function fetchMarketsFromPolymarket(): Promise<PolymarketMarket[]> {
    console.log("Fetching markets from Polymarket Gamma API...");

    const allMarkets: PolymarketMarket[] = [];

    // Fetch multiple pages of markets
    for (const order of ["volume24hr", "liquidity", "createdAt"]) {
        const response = await fetch(
            `https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=100&order=${order}&ascending=false`
        );

        if (!response.ok) {
            console.error(`API error for ${order}: ${response.status}`);
            continue;
        }

        const body = await response.json();
        const markets = Array.isArray(body) ? body : (body.data ?? []);
        allMarkets.push(...markets);
    }

    // Deduplicate by slug
    const seen = new Set<string>();
    const uniqueMarkets = allMarkets.filter((m) => {
        if (!m.slug || seen.has(m.slug)) return false;
        seen.add(m.slug);
        return true;
    });

    console.log(`Fetched ${uniqueMarkets.length} unique markets from Polymarket`);

    return uniqueMarkets;
}

async function main() {
    console.log("=".repeat(60));
    console.log("Polyflux Oracle Population Script");
    console.log("=".repeat(60));

    const accounts = await web3.eth.getAccounts();
    const signer = accounts[0];
    console.log("Using signer:", signer);

    const oracle = await PredictionMarketOracle.at(ORACLE_ADDRESS);

    // Check owner
    const owner = await oracle.owner();
    console.log("Oracle owner:", owner);

    if (owner.toLowerCase() !== signer.toLowerCase()) {
        console.error("ERROR: Signer is not the oracle owner!");
        console.error("You need to use the owner account to populate oracle data.");
        return;
    }

    // Fetch markets from Polymarket
    const markets = await fetchMarketsFromPolymarket();

    // Filter for markets with valid data (reduced liquidity requirement for more coverage)
    const validMarkets = markets.filter((m: PolymarketMarket) => {
        if (!m.outcomePrices || !m.slug) return false;
        try {
            const prices = JSON.parse(m.outcomePrices);
            if (prices.length < 2) return false;
            // Must match contract's MIN_LIQUIDITY ($1000 scaled by 1e6)
            if (m.liquidityNum < 1000) return false;
            return true;
        } catch {
            return false;
        }
    });

    console.log(`\nFound ${validMarkets.length} valid markets with sufficient liquidity\n`);

    let successCount = 0;
    const skipCount = 0;
    let errorCount = 0;

    for (const market of validMarkets) {
        try {
            const prices = JSON.parse(market.outcomePrices);
            const yesPriceRaw = parseFloat(prices[0]);
            const noPriceRaw = parseFloat(prices[1]);
            const volumeRaw = market.volumeNum;
            const liquidityRaw = market.liquidityNum;

            // Skip if any values are NaN/invalid
            if (isNaN(yesPriceRaw) || isNaN(noPriceRaw) || !Number.isFinite(volumeRaw) || !Number.isFinite(liquidityRaw)) {
                console.log(`⏭️  Skipping ${market.slug}: invalid price/volume data`);
                continue;
            }

            const yesPrice = Math.floor(yesPriceRaw * 10000); // Convert to basis points
            const noPrice = Math.floor(noPriceRaw * 10000);
            const volume = BigInt(Math.floor(volumeRaw * 1e6));
            const liquidity = BigInt(Math.floor(liquidityRaw * 1e6));

            // Always update to refresh timestamp (required for freshness check)

            console.log(`📝 Setting data for: ${market.slug}`);
            console.log(`   Question: ${market.question.substring(0, 60)}...`);
            console.log(
                `   YES: ${yesPrice} bps, NO: ${noPrice} bps, Sum: ${yesPrice + noPrice}`
            );
            console.log(
                `   Vol: ${volume.toString()}, Liq: ${liquidity.toString()} (raw: $${liquidityRaw.toLocaleString()})`
            );

            // Skip gas estimation and use fixed gas
            const tx = await oracle.setMarketDataForTesting(
                market.slug,
                market.question,
                yesPrice,
                noPrice,
                volume.toString(),
                liquidity.toString(),
                { from: signer, gas: 500000 }
            );

            console.log(`   TX: ${tx.tx}`);
            console.log(`   ✅ Confirmed!\n`);
            successCount++;

            // Delay between TXs to avoid RPC rate limits
            await new Promise((r) => setTimeout(r, 3000));
        } catch (err: any) {
            const isRateLimit = err.message?.includes("Too Many Requests");
            console.error(`   ❌ Error: ${err.message}`);
            if (err.reason) console.error(`   Reason: ${err.reason}`);
            
            if (isRateLimit) {
                console.log(`   ⏳ Rate limited — backing off 30s then retrying...`);
                await new Promise((r) => setTimeout(r, 30000));
                // Retry once
                try {
                    const retryTx = await oracle.setMarketDataForTesting(
                        market.slug,
                        market.question,
                        Math.floor(parseFloat(JSON.parse(market.outcomePrices)[0]) * 10000),
                        Math.floor(parseFloat(JSON.parse(market.outcomePrices)[1]) * 10000),
                        BigInt(Math.floor(market.volumeNum * 1e6)).toString(),
                        BigInt(Math.floor(market.liquidityNum * 1e6)).toString(),
                        { from: signer, gas: 500000 }
                    );
                    console.log(`   TX (retry): ${retryTx.tx}`);
                    console.log(`   ✅ Confirmed on retry!\n`);
                    successCount++;
                    await new Promise((r) => setTimeout(r, 5000));
                    continue;
                } catch (retryErr: any) {
                    console.error(`   ❌ Retry also failed: ${retryErr.message}\n`);
                }
            }
            
            errorCount++;
        }
    }

    console.log("=".repeat(60));
    console.log("Population complete!");
    console.log(`✅ Success: ${successCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log("=".repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
