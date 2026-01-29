/**
 * POLYFLUX Production Deployment Script
 *
 * Deploys all contracts for production use with FDC oracle.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-production.ts --network coston2
 *   npx hardhat run scripts/deploy-production.ts --network flare
 */

import hre, { run, web3 } from "hardhat";
import * as fs from "fs";

const MockUSDC = artifacts.require("MockERC20");
const PredictionMarketOracleV2 = artifacts.require("PredictionMarketOracleV2");
const PredictionDerivatives = artifacts.require("PredictionDerivatives");

interface DeploymentAddresses {
    network: string;
    chainId: number;
    deployer: string;
    usdc: string;
    oracle: string;
    derivatives: string;
    timestamp: string;
}

async function main() {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    const chainId = await web3.eth.getChainId();

    console.log("═".repeat(60));
    console.log("  POLYFLUX Production Deployment");
    console.log("═".repeat(60));
    console.log(`  Network: ${hre.network.name} (chainId: ${chainId})`);
    console.log(`  Deployer: ${deployer}`);

    const balance = await web3.eth.getBalance(deployer);
    console.log(`  Balance: ${web3.utils.fromWei(balance, "ether")} ${chainId === 14n ? "FLR" : "C2FLR"}`);
    console.log("═".repeat(60));
    console.log("");

    // 1. Deploy MockUSDC (or use existing USDC on mainnet)
    console.log("1. Deploying MockUSDC...");
    const usdc = await MockUSDC.new("Mock USDC", "USDC", 6);
    console.log(`   ✅ USDC: ${usdc.address}`);

    // 2. Deploy PredictionMarketOracleV2 (FDC-powered, permissionless)
    console.log("\n2. Deploying PredictionMarketOracleV2...");
    const oracle = await PredictionMarketOracleV2.new();
    console.log(`   ✅ Oracle V2: ${oracle.address}`);

    // 3. Deploy PredictionDerivatives
    console.log("\n3. Deploying PredictionDerivatives...");
    const derivatives = await PredictionDerivatives.new(usdc.address, oracle.address);
    console.log(`   ✅ Derivatives: ${derivatives.address}`);

    // Verify contracts
    console.log("\n4. Verifying contracts...");
    try {
        await run("verify:verify", { address: usdc.address, constructorArguments: ["Mock USDC", "USDC", 6] });
        await run("verify:verify", { address: oracle.address, constructorArguments: [] });
        await run("verify:verify", {
            address: derivatives.address,
            constructorArguments: [usdc.address, oracle.address],
        });
        console.log("   ✅ All contracts verified");
    } catch (e: any) {
        console.log("   ⚠️ Verification failed:", e.message);
    }

    // Save deployment addresses
    const deployment: DeploymentAddresses = {
        network: hre.network.name,
        chainId: Number(chainId),
        deployer: deployer,
        usdc: usdc.address,
        oracle: oracle.address,
        derivatives: derivatives.address,
        timestamp: new Date().toISOString(),
    };

    const deploymentsDir = "./deployments";
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const filename = `${deploymentsDir}/${hre.network.name}-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(deployment, null, 2));
    console.log(`\n   📁 Saved to: ${filename}`);

    // Print summary
    console.log("");
    console.log("═".repeat(60));
    console.log("  Deployment Complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("  Contract Addresses:");
    console.log(`    USDC:        ${usdc.address}`);
    console.log(`    Oracle V2:   ${oracle.address}`);
    console.log(`    Derivatives: ${derivatives.address}`);
    console.log("");
    console.log("  Environment Variables:");
    console.log(`    USDC_ADDRESS=${usdc.address}`);
    console.log(`    ORACLE_ADDRESS=${oracle.address}`);
    console.log(`    DERIVATIVES_ADDRESS=${derivatives.address}`);
    console.log("");
    console.log("  Next Steps:");
    console.log("  1. Update frontend/src/wagmi.js with new addresses");
    console.log("  2. Update keeper/.env with new addresses");
    console.log("  3. Start the FDC keeper: cd keeper && npm run fdc");
    console.log("  4. Monitor at: https://coston2-explorer.flare.network");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
