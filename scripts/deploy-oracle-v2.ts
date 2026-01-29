/**
 * Deploy PredictionMarketOracleV2
 *
 * Usage:
 *   npx hardhat run scripts/deploy-oracle-v2.ts --network coston2
 */

import { run, web3 } from "hardhat";

const PredictionMarketOracleV2 = artifacts.require("PredictionMarketOracleV2");

async function main() {
    console.log("═".repeat(60));
    console.log("  Deploying PredictionMarketOracleV2");
    console.log("═".repeat(60));

    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    console.log(`  Deployer: ${deployer}`);

    const balance = await web3.eth.getBalance(deployer);
    console.log(`  Balance: ${web3.utils.fromWei(balance, "ether")} C2FLR`);
    console.log("");

    // Deploy Oracle V2
    console.log("Deploying PredictionMarketOracleV2...");
    const oracle = await PredictionMarketOracleV2.new();

    console.log(`  ✅ Oracle V2 deployed: ${oracle.address}`);

    // Verify contract
    try {
        await run("verify:verify", {
            address: oracle.address,
            constructorArguments: [],
        });
        console.log("  ✅ Contract verified");
    } catch (e: any) {
        console.log("  ⚠️ Verification failed:", e.message);
    }

    console.log("");
    console.log("═".repeat(60));
    console.log("  Deployment Complete!");
    console.log("═".repeat(60));
    console.log("");
    console.log("  Update your .env:");
    console.log(`  ORACLE_ADDRESS=${oracle.address}`);
    console.log("");
    console.log("  Next steps:");
    console.log("  1. Test FDC attestation:");
    console.log("     npx hardhat run scripts/fdc/PolymarketWeb2Json.ts --network coston2");
    console.log("");
    console.log("  2. Run production keeper:");
    console.log("     cd keeper && npm run fdc");
    console.log("");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });
