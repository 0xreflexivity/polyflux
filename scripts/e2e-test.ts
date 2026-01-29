/**
 * POLYFLUX E2E Test - V2 Oracle via FDC Web2Json
 *
 * Tests the full flow: Polymarket CLOB API → FDC attestation → V2 Oracle on-chain
 * Following the hardhat-gitlab fdcExample/Web2Json.ts pattern.
 *
 * Usage:
 *   npx hardhat run scripts/e2e-test.ts --network coston2
 */

import { run, web3 } from "hardhat";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "./utils/fdc";

const PredictionMarketOracleV2 = artifacts.require("PredictionMarketOracleV2");

const { WEB2JSON_VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL, ORACLE_ADDRESS } = process.env;

// ============ POLYMARKET CONFIG ============

const CLOB_API = "https://clob.polymarket.com";

// ============ FDC CONFIG ============

const attestationTypeBase = "Web2Json";
const sourceIdBase = "PublicWeb2";
const verifierUrlBase = WEB2JSON_VERIFIER_URL_TESTNET;

// ABI signature for the MarketDTO struct
const abiSignature = `{"components": [{"internalType": "string", "name": "marketId", "type": "string"},{"internalType": "string", "name": "question", "type": "string"},{"internalType": "uint256", "name": "yesPrice", "type": "uint256"},{"internalType": "uint256", "name": "noPrice", "type": "uint256"},{"internalType": "uint256", "name": "volume", "type": "uint256"},{"internalType": "uint256", "name": "liquidity", "type": "uint256"}],"name": "MarketDTO","type": "tuple"}`;

/**
 * Build jq transform for CLOB API single market response
 * CLOB /markets/{condition_id} returns a single object with .market_slug, .question, .tokens[]
 */
function buildPostProcessJq(): string {
    return `{marketId: .market_slug, question: .question[0:100], yesPrice: (.tokens[0].price * 10000 | . - (. % 1)), noPrice: (.tokens[1].price * 10000 | . - (. % 1)), volume: 1000000, liquidity: 1000000}`;
}

// ============ FDC FUNCTIONS ============

async function prepareAttestationRequest(conditionId: string) {
    const apiUrl = `${CLOB_API}/markets/${conditionId}`;
    const postProcessJq = buildPostProcessJq();

    const requestBody = {
        url: apiUrl,
        httpMethod: "GET",
        headers: "{}",
        queryParams: "{}",
        body: "{}",
        postProcessJq: postProcessJq,
        abiSignature: abiSignature,
    };

    const url = `${verifierUrlBase}/Web2Json/prepareRequest`;
    const apiKey = VERIFIER_API_KEY_TESTNET ?? "";

    return await prepareAttestationRequestBase(url, apiKey, attestationTypeBase, sourceIdBase, requestBody);
}

async function retrieveDataAndProof(abiEncodedRequest: string, roundId: number) {
    const url = `${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`;
    console.log("DA Layer URL:", url, "\n");
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

// ============ ORACLE FUNCTIONS ============

async function updateOracle(proof: any) {
    if (!ORACLE_ADDRESS) {
        console.log("No ORACLE_ADDRESS set, skipping oracle update\n");
        return;
    }

    const oracle = await PredictionMarketOracleV2.at(ORACLE_ADDRESS);

    console.log("Proof hex:", proof.response_hex, "\n");

    // Decode the proof response using IWeb2JsonVerification ABI
    const IWeb2JsonVerification = await artifacts.require("IWeb2JsonVerification");
    const responseType = IWeb2JsonVerification._json.abi[0].inputs[0].components[1];
    console.log("Response type:", responseType, "\n");

    const decodedResponse = web3.eth.abi.decodeParameter(responseType, proof.response_hex);
    console.log("Decoded proof:", decodedResponse, "\n");

    // Submit to oracle
    const transaction = await oracle.updateMarketData({
        merkleProof: proof.proof,
        data: decodedResponse,
    });
    console.log("Transaction:", transaction.tx, "\n");

    // Verify on-chain data
    const marketId = (decodedResponse as any).responseBody.abiEncodedData
        ? "check manually"
        : (decodedResponse as any).marketId || "unknown";

    try {
        const allIds = await oracle.getAllMarketIds();
        console.log("All market IDs on-chain:", allIds, "\n");

        if (allIds.length > 0) {
            const marketData = await oracle.getMarketData(allIds[allIds.length - 1]);
            console.log("Latest market data:", marketData, "\n");
        }
    } catch (e: any) {
        console.log("Could not read market data:", e.message, "\n");
    }
}

// ============ FETCH MARKET ============

async function fetchActiveMarket(): Promise<{ slug: string; conditionId: string }> {
    // Fetch a single active market from CLOB API
    const response = await fetch(`${CLOB_API}/sampling-markets?limit=5`);
    const apiResponse = await response.json();
    const markets = apiResponse.data || [];

    for (const m of markets) {
        if (m.tokens && m.tokens.length >= 2 && m.question && m.market_slug && m.condition_id) {
            return { slug: m.market_slug, conditionId: m.condition_id };
        }
    }
    throw new Error("No active markets found");
}

// ============ MAIN ============

async function main() {
    console.log("═".repeat(60));
    console.log("  POLYFLUX E2E Test (V2 Oracle + FDC)");
    console.log("═".repeat(60));
    console.log(`  Oracle: ${ORACLE_ADDRESS || "Not set"}`);
    console.log(`  Verifier: ${verifierUrlBase}`);
    console.log(`  DA Layer: ${COSTON2_DA_LAYER_URL}`);
    console.log("═".repeat(60));

    // Step 1: Find an active market
    console.log("\n=== Step 1: Fetching active market from Polymarket ===\n");
    const market = await fetchActiveMarket();
    console.log(`  Market: ${market.slug}`);
    console.log(`  Condition: ${market.conditionId}\n`);

    // Step 2: Prepare attestation request
    console.log("=== Step 2: Preparing FDC attestation request ===\n");
    const data = await prepareAttestationRequest(market.conditionId);
    console.log("Data:", data, "\n");

    const abiEncodedRequest = data.abiEncodedRequest;

    // Step 3: Submit to FdcHub and get round ID
    console.log("=== Step 3: Submitting to FdcHub ===\n");
    const roundId = await submitAttestationRequest(abiEncodedRequest);

    // Step 4: Wait for proof from DA layer
    console.log("=== Step 4: Waiting for proof ===\n");
    const proof = await retrieveDataAndProof(abiEncodedRequest, roundId);

    // Step 5: Update oracle with proof
    console.log("=== Step 5: Updating V2 Oracle ===\n");
    await updateOracle(proof);

    console.log("✅ E2E test completed successfully!\n");
}

void main().then(() => {
    process.exit(0);
});
