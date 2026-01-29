import { run, web3 } from "hardhat";
import { PredictionMarketOracleV2Instance } from "../../typechain-types";
import {
    prepareAttestationRequestBase,
    submitAttestationRequest,
    retrieveDataAndProofBaseWithRetry,
} from "../utils/fdc";

const PredictionMarketOracleV2 = artifacts.require("PredictionMarketOracleV2");

const { WEB2JSON_VERIFIER_URL_TESTNET, VERIFIER_API_KEY_TESTNET, COSTON2_DA_LAYER_URL, ORACLE_ADDRESS } = process.env;

// yarn hardhat run scripts/fdc/PolymarketWeb2Json.ts --network coston2

// ============ POLYMARKET CONFIGURATION ============

const POLYMARKET_API = "https://gamma-api.polymarket.com";

// Default market for testing
const defaultMarketSlug = "will-bitcoin-reach-150k-in-january-2026";

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
 *   "yesPrice": 4500,      // basis points (0.45 * 10000)
 *   "noPrice": 5500,       // basis points
 *   "volume": 123456780000, // scaled by 1e6
 *   "liquidity": 50000000000 // scaled by 1e6
 * }
 */
function buildPostProcessJq(): string {
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

// ABI signature for the MarketDTO struct
const abiSignature = `{"components": [{"internalType": "string", "name": "marketId", "type": "string"},{"internalType": "string", "name": "question", "type": "string"},{"internalType": "uint256", "name": "yesPrice", "type": "uint256"},{"internalType": "uint256", "name": "noPrice", "type": "uint256"},{"internalType": "uint256", "name": "volume", "type": "uint256"},{"internalType": "uint256", "name": "liquidity", "type": "uint256"}],"name": "MarketDTO","type": "tuple"}`;

// Configuration constants
const attestationTypeBase = "Web2Json";
const sourceIdBase = "testIgnite";
const verifierUrlBase = WEB2JSON_VERIFIER_URL_TESTNET;

// ============ ATTESTATION FUNCTIONS ============

async function prepareAttestationRequest(marketSlug: string) {
    const apiUrl = `${POLYMARKET_API}/markets?slug=${marketSlug}`;
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
    console.log("Url:", url, "\n");
    return await retrieveDataAndProofBaseWithRetry(url, abiEncodedRequest, roundId);
}

async function getOrDeployOracle(): Promise<PredictionMarketOracleV2Instance> {
    if (ORACLE_ADDRESS) {
        console.log("Using existing oracle at:", ORACLE_ADDRESS, "\n");
        return await PredictionMarketOracleV2.at(ORACLE_ADDRESS);
    }

    // Deploy new oracle
    const args: any[] = [];
    const oracle: PredictionMarketOracleV2Instance = await PredictionMarketOracleV2.new(...args);
    try {
        await run("verify:verify", {
            address: oracle.address,
            constructorArguments: args,
        });
    } catch (e: any) {
        console.log(e);
    }
    console.log("PredictionMarketOracleV2 deployed to", oracle.address, "\n");
    return oracle;
}

async function submitProofToOracle(oracle: PredictionMarketOracleV2Instance, proof: any) {
    console.log("Proof hex:", proof.response_hex, "\n");

    // Decode the proof response using the IWeb2JsonVerification artifact
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

    // Verify the update
    const marketData = await oracle.getMarketData((decodedResponse as any).marketId);
    console.log("Updated market data:", marketData, "\n");
}

// ============ MAIN ============

async function main() {
    // Get market slug from command line args or use default
    const args = process.argv.slice(2);
    const marketSlug = args.find((arg) => !arg.startsWith("--")) || defaultMarketSlug;

    console.log("═".repeat(60));
    console.log("  POLYFLUX - Polymarket FDC Attestation");
    console.log("═".repeat(60));
    console.log(`  Market: ${marketSlug}`);
    console.log(`  Verifier: ${verifierUrlBase}`);
    console.log("═".repeat(60));

    // Step 1: Prepare attestation request
    const data = await prepareAttestationRequest(marketSlug);
    console.log("Data:", data, "\n");

    const abiEncodedRequest = data.abiEncodedRequest;

    // Step 2: Submit to FdcHub
    const roundId = await submitAttestationRequest(abiEncodedRequest);

    // Step 3: Wait for proof and retrieve
    const proof = await retrieveDataAndProof(abiEncodedRequest, roundId);

    // Step 4: Get oracle and submit proof
    const oracle = await getOrDeployOracle();
    await submitProofToOracle(oracle, proof);

    console.log("✅ Market data updated via FDC!\n");
}

void main().then(() => {
    process.exit(0);
});
