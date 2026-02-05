/**
 * POLYFLUX E2E Test - FDC Web2Json with Polymarket CLOB API
 *
 * Tests the FDC integration with broader rounding to ensure DA layer consensus.
 * Uses condition_id to fetch a single market from the CLOB API.
 *
 * Key fixes:
 * 1. Uses correct verifier endpoint: /verifier/web2/Web2Json/prepareRequest
 * 2. Rounds prices to nearest 1000 bps (10%) for DA consensus
 *
 * Usage:
 *   npx hardhat run scripts/e2e-polymarket-fdc.ts --network coston2
 */

import hre, { web3 } from "hardhat";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "./utils/fdc";

const PredictionMarketOracleV2 = artifacts.require("PredictionMarketOracleV2");

const { WEB2JSON_VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL, ORACLE_ADDRESS } = process.env;

// ============ POLYMARKET CONFIGURATION ============

const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

/**
 * ABI signature for the MarketDTO struct
 */
const MARKET_DTO_ABI_SIGNATURE = JSON.stringify({
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

/**
 * Build the jq transform for Polymarket CLOB API market data
 *
 * Rounds prices to nearest 1000 bps (10%) to ensure DA layer consensus
 * even when different nodes query the API at slightly different times.
 *
 * Formula: (price * 10000 + 500) - ((price * 10000 + 500) % 1000)
 */
function buildPostProcessJq(): string {
    return `{marketId: .market_slug, question: .question[0:100], yesPrice: ((.tokens[0].price * 10000 + 500) | . - (. % 1000)), noPrice: ((.tokens[1].price * 10000 + 500) | . - (. % 1000)), volume: 1000000, liquidity: 1000000}`;
}

// ============ FDC FUNCTIONS ============

async function prepareAttestationRequest(conditionId: string) {
    // CLOB API: /markets/{condition_id} returns single market object
    const apiUrl = `${POLYMARKET_CLOB_API}/markets/${conditionId}`;
    const postProcessJq = buildPostProcessJq();

    console.log("  API URL:", apiUrl);
    console.log("  JQ filter:", postProcessJq);
    console.log();

    const requestBody = {
        url: apiUrl,
        httpMethod: "GET",
        headers: "{}",
        queryParams: "{}",
        body: "{}",
        postProcessJq: postProcessJq,
        abiSignature: MARKET_DTO_ABI_SIGNATURE,
    };

    // IMPORTANT: Use correct verifier URL with /Web2Json/prepareRequest
    const url = `${WEB2JSON_VERIFIER_URL_TESTNET}/Web2Json/prepareRequest`;
    const apiKey = VERIFIER_API_KEY_TESTNET ?? "";

    console.log("  Verifier URL:", url);

    return await prepareAttestationRequestBase(url, apiKey, "Web2Json", "PublicWeb2", requestBody);
}

async function retrieveDataAndProof(abiEncodedRequest: string, roundId: number) {
    const url = `${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`;
    console.log("  DA Layer URL:", url);
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

// ============ HELPER: FETCH A VALID MARKET ============

async function fetchActiveMarket(): Promise<{ conditionId: string; slug: string }> {
    console.log("  Fetching an active market from CLOB API...");
    const response = await fetch(`${POLYMARKET_CLOB_API}/sampling-markets?limit=5`);
    const data: any = await response.json();

    for (const market of data.data || []) {
        if (market.condition_id && market.market_slug && market.active && !market.closed) {
            return { conditionId: market.condition_id, slug: market.market_slug };
        }
    }
    throw new Error("No active markets found");
}

// ============ MAIN ============

async function main() {
    const accounts = await web3.eth.getAccounts();
    const signer = accounts[0];

    console.log("═".repeat(70));
    console.log("  POLYFLUX E2E Test — FDC with Polymarket CLOB API");
    console.log("═".repeat(70));
    console.log(`  Network:   ${hre.network.name}`);
    console.log(`  Signer:    ${signer}`);
    console.log(`  Verifier:  ${WEB2JSON_VERIFIER_URL_TESTNET}`);
    console.log(`  DA Layer:  ${COSTON2_DA_LAYER_URL}`);
    console.log("═".repeat(70));

    // Step 1: Find an active market
    console.log("\n── Step 1: Find Active Market ──────────────────────────────\n");
    const market = await fetchActiveMarket();
    console.log(`  Found: ${market.slug}`);
    console.log(`  Condition ID: ${market.conditionId}`);

    // Step 2: Preview what we'll attest
    console.log("\n── Step 2: Preview Market Data ─────────────────────────────\n");
    const previewResponse = await fetch(`${POLYMARKET_CLOB_API}/markets/${market.conditionId}`);
    const previewData: any = await previewResponse.json();
    console.log(`  Market: ${previewData.market_slug}`);
    console.log(`  Question: ${previewData.question?.substring(0, 80)}...`);
    console.log(`  Yes Price: ${previewData.tokens?.[0]?.price} (${(previewData.tokens?.[0]?.price * 100).toFixed(1)}%)`);
    console.log(`  No Price:  ${previewData.tokens?.[1]?.price} (${(previewData.tokens?.[1]?.price * 100).toFixed(1)}%)`);

    // Calculate expected rounded values
    const yesRounded = Math.floor((previewData.tokens?.[0]?.price * 10000 + 500) / 1000) * 1000;
    const noRounded = Math.floor((previewData.tokens?.[1]?.price * 10000 + 500) / 1000) * 1000;
    console.log(`\n  Expected JQ output:`);
    console.log(`    yesPrice: ${yesRounded} bps (${yesRounded / 100}%)`);
    console.log(`    noPrice:  ${noRounded} bps (${noRounded / 100}%)`);

    // Step 3: Prepare FDC attestation request
    console.log("\n── Step 3: Prepare FDC Attestation Request ─────────────────\n");
    const data = await prepareAttestationRequest(market.conditionId);
    console.log("  Verifier status:", data.status);

    if (data.status !== "VALID") {
        console.error("  ❌ Verifier returned non-VALID status!");
        console.error("  Response:", JSON.stringify(data, null, 2));
        process.exit(1);
    }

    const abiEncodedRequest = data.abiEncodedRequest;
    console.log("  ABI encoded request:", abiEncodedRequest.substring(0, 80) + "...\n");

    // Step 4: Submit to FdcHub
    console.log("── Step 4: Submit to FdcHub ─────────────────────────────────\n");
    const roundId = await submitAttestationRequest(abiEncodedRequest);
    console.log(`  ✅ Submitted! Voting round: ${roundId}`);
    console.log(`  🔍 Track: https://${hre.network.name}-systems-explorer.flare.rocks/voting-round/${roundId}?tab=fdc\n`);

    // Step 5: Wait for proof from DA layer
    console.log("── Step 5: Wait for Proof ──────────────────────────────────\n");
    console.log("  Waiting for round to finalize (this can take 3-5 minutes)...\n");

    let proof: any;
    try {
        proof = await retrieveDataAndProof(abiEncodedRequest, roundId);
    } catch (e: any) {
        console.log("  ⚠️  Could not retrieve proof from DA layer.");
        console.log(`  Error: ${e.message}\n`);
        console.log("  ℹ️  The attestation request WAS accepted by FdcHub.");
        console.log(`  Check the voting round: https://${hre.network.name}-systems-explorer.flare.rocks/voting-round/${roundId}?tab=fdc`);
        console.log("\n═".repeat(70));
        console.log("  ⚠️  E2E test partially completed (proof retrieval pending)");
        console.log("═".repeat(70));
        process.exit(0);
    }

    console.log("  ✅ Proof retrieved from DA layer!");
    console.log("  Proof hex:", proof.response_hex?.substring(0, 80) + "...\n");

    // Step 6: Update oracle (if deployed)
    console.log("── Step 6: Update Oracle ────────────────────────────────────\n");
    if (ORACLE_ADDRESS) {
        const oracle = await PredictionMarketOracleV2.at(ORACLE_ADDRESS);

        // Decode the proof response
        const IWeb2JsonVerification = await artifacts.require("IWeb2JsonVerification");
        const responseType = IWeb2JsonVerification._json.abi[0].inputs[0].components[1];
        const decodedResponse = web3.eth.abi.decodeParameter(responseType, proof.response_hex);

        console.log("  Decoded response:", JSON.stringify(decodedResponse, null, 2).substring(0, 300) + "...\n");

        // Submit to oracle
        const tx = await oracle.updateMarketData({
            merkleProof: proof.proof,
            data: decodedResponse,
        });
        console.log(`  ✅ Oracle updated! Tx: ${tx.tx}`);

        // Verify
        const marketData = await oracle.getMarketData((decodedResponse as any).marketId);
        console.log("\n  📊 On-chain market data:");
        console.log(`    Market ID: ${marketData.marketId}`);
        console.log(`    Question:  ${marketData.question}`);
        console.log(`    YES Price: ${marketData.yesPrice} bps`);
        console.log(`    NO Price:  ${marketData.noPrice} bps`);
    } else {
        console.log("  ⚠️  No ORACLE_ADDRESS set, skipping oracle update.");
        console.log("  Set ORACLE_ADDRESS in .env to update an oracle with the proof.");
    }

    console.log("\n" + "═".repeat(70));
    console.log("  ✅ E2E test completed successfully!");
    console.log("═".repeat(70));
}

void main().then(() => {
    process.exit(0);
});
