/**
 * POLYFLUX Production FDC Keeper
 *
 * Permissionless keeper that updates oracle prices via Flare FDC attestations.
 * Anyone can run this keeper - no special permissions needed.
 *
 * Flow:
 * 1. Monitor markets that need price updates
 * 2. Request FDC Web2Json attestations for Polymarket data
 * 3. Wait for voting round finalization
 * 4. Retrieve proofs from DA layer
 * 5. Submit proofs to oracle contract
 *
 * Usage:
 *   npx ts-node src/fdc-keeper.ts
 */

import { ethers } from "ethers";
import "dotenv/config";

import { Config, MarketData, PolymarketApiMarket, MARKET_DTO_ABI_SIGNATURE } from "./types";
import { sleep, buildPostProcessJq } from "./utils/core";
import {
    prepareAttestationRequestBase,
    calculateRoundId,
    submitAttestationRequest,
    waitForRoundFinalization,
    retrieveProofFromDALayer,
    getContractAddressByName,
    CONTRACT_REGISTRY,
    REGISTRY_ABI,
    FDC_HUB_ABI,
    FEE_CONFIG_ABI,
    RELAY_ABI,
    SYSTEMS_MANAGER_ABI,
    FDC_VERIFICATION_ABI,
} from "./utils/fdc";

// Import ABI from compiled artifact
import PredictionMarketOracleV2Artifact from "../../artifacts/contracts/PredictionMarketOracleV2.sol/PredictionMarketOracleV2.json";

// ============ CONFIGURATION ============

const config: Config = {
    // Network
    rpcUrl: process.env.RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
    privateKey: process.env.PRIVATE_KEY || "",
    oracleAddress: process.env.ORACLE_ADDRESS || "",

    // FDC Endpoints
    web2JsonVerifierUrl: process.env.WEB2JSON_VERIFIER_URL || "https://web2json-verifier-test.flare.rocks/",
    daLayerUrl: process.env.DA_LAYER_URL || "https://ctn2-data-availability.flare.network/",
    verifierApiKey: process.env.VERIFIER_API_KEY || "00000000-0000-0000-0000-000000000000",

    // FDC Attestation Config
    attestationType: "Web2Json",
    sourceId: "PublicWeb2",

    // Polymarket
    polymarketApi: "https://gamma-api.polymarket.com",

    // Timing
    updateIntervalMs: parseInt(process.env.UPDATE_INTERVAL_MS || "600000"), // 10 min
    maxStalenessSeconds: 3600, // 1 hour
    maxMarketsPerCycle: 10,
};

// ============ ORACLE ABI ============

// ABI from compiled artifact
const ORACLE_ABI = PredictionMarketOracleV2Artifact.abi;

// ============ FDC KEEPER CLASS ============

class FdcKeeper {
    private provider: ethers.JsonRpcProvider;
    private wallet: ethers.Wallet;
    private oracle: ethers.Contract;
    private registry: ethers.Contract;

    // FDC contracts - initialized in init()
    private fdcHub!: ethers.Contract;
    private feeConfig!: ethers.Contract;
    private relay!: ethers.Contract;
    private systemsManager!: ethers.Contract;
    private fdcVerification!: ethers.Contract;
    private protocolId!: number;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
        this.wallet = new ethers.Wallet(config.privateKey, this.provider);
        this.oracle = new ethers.Contract(config.oracleAddress, ORACLE_ABI, this.wallet);
        this.registry = new ethers.Contract(CONTRACT_REGISTRY, REGISTRY_ABI, this.provider);
    }

    async initialize(): Promise<void> {
        console.log("═".repeat(60));
        console.log("  POLYFLUX FDC Keeper (Production Mode)");
        console.log("═".repeat(60));
        console.log(`  RPC: ${config.rpcUrl}`);
        console.log(`  Oracle: ${config.oracleAddress}`);
        console.log(`  Keeper: ${this.wallet.address}`);

        const balance = await this.provider.getBalance(this.wallet.address);
        console.log(`  Balance: ${ethers.formatEther(balance)} C2FLR`);

        // Get FDC contract addresses from registry
        const fdcHubAddress = await getContractAddressByName(this.registry, "FdcHub");
        const feeConfigAddress = await getContractAddressByName(this.registry, "FdcRequestFeeConfigurations");
        const relayAddress = await getContractAddressByName(this.registry, "Relay");
        const systemsManagerAddress = await getContractAddressByName(this.registry, "FlareSystemsManager");
        const fdcVerificationAddress = await getContractAddressByName(this.registry, "FdcVerification");

        this.fdcHub = new ethers.Contract(fdcHubAddress, FDC_HUB_ABI, this.wallet);
        this.feeConfig = new ethers.Contract(feeConfigAddress, FEE_CONFIG_ABI, this.provider);
        this.relay = new ethers.Contract(relayAddress, RELAY_ABI, this.provider);
        this.systemsManager = new ethers.Contract(systemsManagerAddress, SYSTEMS_MANAGER_ABI, this.provider);
        this.fdcVerification = new ethers.Contract(fdcVerificationAddress, FDC_VERIFICATION_ABI, this.provider);

        this.protocolId = Number(await this.fdcVerification.fdcProtocolId());

        console.log(`  FdcHub: ${fdcHubAddress}`);
        console.log(`  ProtocolId: ${this.protocolId}`);
        console.log("═".repeat(60));
        console.log("");
    }

    /**
     * Fetch markets from Polymarket that need updates
     */
    async fetchMarketsNeedingUpdate(): Promise<string[]> {
        try {
            const response = await fetch(
                `${config.polymarketApi}/markets?limit=${config.maxMarketsPerCycle}&active=true&closed=false&order=volume24hr&ascending=false`
            );
            const markets = (await response.json()) as PolymarketApiMarket[];

            const needsUpdate: string[] = [];

            for (const market of markets) {
                if (!market.slug || !market.outcomePrices) continue;
                if ((market.liquidityNum || 0) < 1000) continue; // Min $1000 liquidity

                try {
                    const isFresh = await this.oracle.isMarketDataFresh(market.slug, config.maxStalenessSeconds);
                    if (!isFresh) {
                        needsUpdate.push(market.slug);
                    }
                } catch {
                    // Market doesn't exist yet
                    needsUpdate.push(market.slug);
                }
            }

            return needsUpdate;
        } catch (error) {
            console.error("Error fetching markets:", error instanceof Error ? error.message : "Unknown error");
            return [];
        }
    }

    /**
     * Prepare attestation request via Web2Json verifier
     */
    async prepareAttestationRequest(marketSlug: string): Promise<{ abiEncodedRequest: string }> {
        const apiUrl = `${config.polymarketApi}/markets?slug=${marketSlug}`;

        const requestBody = {
            url: apiUrl,
            httpMethod: "GET",
            headers: "{}",
            queryParams: "{}",
            body: "{}",
            postProcessJq: buildPostProcessJq(),
            abiSignature: MARKET_DTO_ABI_SIGNATURE,
        };

        const url = `${config.web2JsonVerifierUrl}Web2Json/prepareRequest`;

        return await prepareAttestationRequestBase(
            url,
            config.verifierApiKey,
            config.attestationType,
            config.sourceId,
            requestBody
        );
    }

    /**
     * Update a single market via FDC
     */
    async updateMarketViaFdc(marketSlug: string): Promise<boolean> {
        console.log(`  📡 ${marketSlug}`);

        try {
            // 1. Prepare request
            const { abiEncodedRequest } = await this.prepareAttestationRequest(marketSlug);
            console.log(`     Prepared attestation request`);

            // 2. Submit to FdcHub
            const { receipt } = await submitAttestationRequest(this.fdcHub, this.feeConfig, abiEncodedRequest);
            const roundId = await calculateRoundId(this.provider, this.systemsManager, receipt.blockNumber);
            console.log(`     Submitted to FdcHub (round ${roundId})`);

            // 3. Wait for finalization
            await waitForRoundFinalization(this.relay, this.protocolId, roundId);

            // 4. Retrieve proof
            const proof = await retrieveProofFromDALayer(config.daLayerUrl, abiEncodedRequest, roundId);

            // 5. Submit to oracle
            const proofStruct = {
                merkleProof: proof.proof,
                data: proof.response_hex,
            };

            const tx = await this.oracle.updateMarketData(proofStruct);
            await tx.wait();
            console.log(`     ✅ Oracle updated`);

            return true;
        } catch (error) {
            console.error(`     ❌ Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
            return false;
        }
    }

    /**
     * Run one update cycle
     */
    async runCycle(): Promise<void> {
        console.log(`\n[${new Date().toISOString()}] Starting FDC update cycle...\n`);

        const marketsToUpdate = await this.fetchMarketsNeedingUpdate();
        console.log(`  Found ${marketsToUpdate.length} markets needing update\n`);

        if (marketsToUpdate.length === 0) {
            console.log("  All markets are fresh\n");
            return;
        }

        let updated = 0;
        let failed = 0;

        for (const slug of marketsToUpdate.slice(0, config.maxMarketsPerCycle)) {
            const success = await this.updateMarketViaFdc(slug);
            if (success) updated++;
            else failed++;

            await sleep(2000); // Rate limiting
        }

        console.log(`\n  Cycle complete: ${updated} updated, ${failed} failed\n`);
    }

    /**
     * Start the keeper service
     */
    async start(): Promise<void> {
        await this.initialize();

        // Run immediately
        await this.runCycle();

        // Schedule periodic runs
        console.log(`Next cycle in ${config.updateIntervalMs / 1000}s...\n`);
        setInterval(async () => {
            await this.runCycle();
            console.log(`Next cycle in ${config.updateIntervalMs / 1000}s...\n`);
        }, config.updateIntervalMs);
    }
}

// ============ MAIN ============

async function main(): Promise<void> {
    if (!config.privateKey) {
        console.error("❌ PRIVATE_KEY required");
        process.exit(1);
    }
    if (!config.oracleAddress) {
        console.error("❌ ORACLE_ADDRESS required");
        process.exit(1);
    }

    const keeper = new FdcKeeper();
    await keeper.start();
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
