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

        const markets = await response.json();
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
            // Lower threshold to get more markets
            if (m.liquidityNum < 100) return false;
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
            const yesPrice = Math.floor(parseFloat(prices[0]) * 10000); // Convert to basis points
            const noPrice = Math.floor(parseFloat(prices[1]) * 10000);
            const volume = BigInt(Math.floor(market.volumeNum * 1e6));
            const liquidity = BigInt(Math.floor(market.liquidityNum * 1e6));

            // Always update to refresh timestamp (required for freshness check)

            console.log(`📝 Setting data for: ${market.slug}`);
            console.log(`   Question: ${market.question.substring(0, 60)}...`);
            console.log(
                `   YES: ${yesPrice / 100}%, NO: ${noPrice / 100}%, Vol: $${market.volumeNum.toLocaleString()}`
            );

            const tx = await oracle.setMarketDataForTesting(
                market.slug,
                market.question,
                yesPrice,
                noPrice,
                volume.toString(),
                liquidity.toString(),
                { from: signer }
            );

            console.log(`   TX: ${tx.tx}`);
            console.log(`   ✅ Confirmed!\n`);
            successCount++;

            // Small delay to avoid rate limiting
            await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
            console.error(`   ❌ Error: ${err instanceof Error ? err.message : "Unknown error"}\n`);
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
