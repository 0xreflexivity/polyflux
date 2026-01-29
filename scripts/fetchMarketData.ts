import { run, web3 } from "hardhat";
import { PredictionMarketOracleInstance } from "../typechain-types";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "./utils/fdc";

const PredictionMarketOracle = artifacts.require("PredictionMarketOracle");

const { WEB2JSON_VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL } = process.env;

// yarn hardhat run scripts/predictionMarket/fetchMarketData.ts --network coston2

/**
 * Polymarket CLOB API configuration
 *
 * The CLOB API returns market data with:
 * - market_slug: market identifier
 * - question: the prediction question
 * - tokens[0].price: YES price (0-1)
 * - tokens[1].price: NO price (0-1)
 */

// Configuration for a specific Polymarket market
// Replace with any active market condition_id from polymarket.com
const MARKET_CONDITION_ID = "0x49686d26fb712515cd5e12c23f0a1c7e10214c7faa3cb0a730aabe0c33694082";

// Polymarket CLOB API URL for single market by condition_id
const getApiUrl = (conditionId: string) => `https://clob.polymarket.com/markets/${conditionId}`;

/**
 * JQ transformation to extract and format market data
 *
 * This transforms the Polymarket CLOB API response into our contract's expected format:
 * - marketId: string identifier (from market_slug)
 * - question: the prediction question text
 * - yesPrice: YES outcome price in basis points (0-10000)
 * - noPrice: NO outcome price in basis points (0-10000)
 * - volume: placeholder (CLOB API doesn't have volume per market)
 * - liquidity: placeholder (CLOB API doesn't have liquidity per market)
 *
 * Note: CLOB API returns single object, not array.
 * Uses | . - (. % 1) to truncate decimals (floor not supported).
 */
const postProcessJq = `{marketId: .market_slug, question: .question[0:100], yesPrice: (.tokens[0].price * 10000 | . - (. % 1)), noPrice: (.tokens[1].price * 10000 | . - (. % 1)), volume: 1000000, liquidity: 1000000}`;

// ABI signature for the MarketDTO struct
const abiSignature = `{
    "components": [
        {"internalType": "string", "name": "marketId", "type": "string"},
        {"internalType": "string", "name": "question", "type": "string"},
        {"internalType": "uint256", "name": "yesPrice", "type": "uint256"},
        {"internalType": "uint256", "name": "noPrice", "type": "uint256"},
        {"internalType": "uint256", "name": "volume", "type": "uint256"},
        {"internalType": "uint256", "name": "liquidity", "type": "uint256"}
    ],
    "name": "MarketDTO",
    "type": "tuple"
}`;

// Configuration constants
const attestationTypeBase = "Web2Json";
const sourceIdBase = "PublicWeb2";  // Unrestricted on testnet - allows any public URL
const verifierUrlBase = WEB2JSON_VERIFIER_URL_TESTNET;

/**
 * Prepare the attestation request for the Web2Json verifier
 */
async function prepareAttestationRequest(conditionId: string) {
    const apiUrl = getApiUrl(conditionId);

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

    console.log("Preparing attestation request for condition_id:", conditionId);
    console.log("API URL:", apiUrl);

    return await prepareAttestationRequestBase(url, apiKey, attestationTypeBase, sourceIdBase, requestBody);
}

/**
 * Retrieve the data and proof from the DA Layer
 */
async function retrieveDataAndProof(abiEncodedRequest: string, roundId: number) {
    const url = `${COSTON2_DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`;
    console.log("DA Layer URL:", url);
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

/**
 * Deploy and verify the PredictionMarketOracle contract
 */
async function deployAndVerifyContract() {
    const args: unknown[] = [];
    const oracle: PredictionMarketOracleInstance = await PredictionMarketOracle.new(...args);

    try {
        await run("verify:verify", {
            address: oracle.address,
            constructorArguments: args,
        });
    } catch (e: unknown) {
        console.log("Verification error (may already be verified):", e);
    }

    console.log("PredictionMarketOracle deployed to:", oracle.address);
    return oracle;
}

/**
 * Submit the proof to the contract and update market data
 */
async function interactWithContract(oracle: PredictionMarketOracleInstance, proof: Record<string, unknown>) {
    console.log("\n--- Submitting proof to contract ---");
    console.log("Proof hex:", proof.response_hex);

    // Get the response type from the IWeb2JsonVerification artifact
    const IWeb2JsonVerification = await artifacts.require("IWeb2JsonVerification");
    const responseType = IWeb2JsonVerification._json.abi[0].inputs[0].components[1];
    console.log("Response type:", JSON.stringify(responseType, null, 2));

    // Decode the response
    const decodedResponse = web3.eth.abi.decodeParameter(responseType, proof.response_hex as string);
    console.log("\nDecoded market data:", decodedResponse);

    // Submit to contract
    const tx = await oracle.updateMarketData({
        merkleProof: proof.proof as string[],
        data: decodedResponse,
    });
    console.log("\nTransaction hash:", tx.tx);

    // Verify the data was stored
    const marketData = await oracle
        .getMarketData((decodedResponse as Record<string, unknown>).responseBody as Record<string, unknown>)
        .catch(() => null);

    if (marketData) {
        console.log("\n--- Stored Market Data ---");
        console.log("Market ID:", marketData.marketId);
        console.log("Question:", marketData.question);
        console.log("YES Price:", Number(marketData.yesPrice) / 100, "%");
        console.log("NO Price:", Number(marketData.noPrice) / 100, "%");
        console.log("Volume: $", Number(marketData.volume) / 1e6);
        console.log("Liquidity: $", Number(marketData.liquidity) / 1e6);
    }
}

/**
 * Main execution flow
 */
async function main() {
    console.log("=".repeat(60));
    console.log("Polymarket Data Oracle - Flare FDC Demo");
    console.log("=".repeat(60));

    // 1. Prepare the attestation request
    console.log("\n[Step 1] Preparing attestation request...");
    const data = await prepareAttestationRequest(MARKET_CONDITION_ID);
    console.log("Attestation data prepared:", JSON.stringify(data, null, 2));

    // 2. Submit to FDC
    console.log("\n[Step 2] Submitting attestation request to FDC...");
    const abiEncodedRequest = data.abiEncodedRequest;
    const roundId = await submitAttestationRequest(abiEncodedRequest);
    console.log("Submitted to round:", roundId);

    // 3. Wait for finalization and retrieve proof
    console.log("\n[Step 3] Waiting for round finalization and retrieving proof...");
    const proof = await retrieveDataAndProof(abiEncodedRequest, roundId);
    console.log("Proof retrieved successfully");

    // 4. Deploy contract
    console.log("\n[Step 4] Deploying PredictionMarketOracle...");
    const oracle = await deployAndVerifyContract();

    // 5. Submit proof to contract
    console.log("\n[Step 5] Updating market data on-chain...");
    await interactWithContract(oracle, proof);

    console.log("\n" + "=".repeat(60));
    console.log("SUCCESS: Polymarket data now available on Flare!");
    console.log("=".repeat(60));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });
