import { web3 } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const MockERC20 = artifacts.require("MockERC20");
const PredictionMarketOracle = artifacts.require("PredictionMarketOracle");
const PredictionDerivatives = artifacts.require("PredictionDerivatives");

const CLOB_API = "https://clob.polymarket.com";

async function main() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  POLYFLUX Full Setup - Deploy & Configure");
    console.log("═══════════════════════════════════════════════════════════\n");

    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    console.log(`Deployer: ${deployer}`);

    const balance = await web3.eth.getBalance(deployer);
    console.log(`Balance: ${web3.utils.fromWei(balance, "ether")} C2FLR\n`);

    // 1. Deploy Mock USDC
    console.log("1. Deploying Mock USDC...");
    const usdc = await MockERC20.new("Mock USDC", "USDC", 6);
    console.log(`   USDC: ${usdc.address}`);

    // Mint USDC to deployer
    await usdc.mint(deployer, web3.utils.toBN("100000000000")); // 100,000 USDC with 6 decimals
    console.log(`   Minted 100,000 USDC to deployer\n`);

    // 2. Deploy Oracle
    console.log("2. Deploying PredictionMarketOracle...");
    const oracle = await PredictionMarketOracle.new();
    console.log(`   Oracle: ${oracle.address}\n`);

    // 3. Deploy Derivatives
    console.log("3. Deploying PredictionDerivatives...");
    const derivatives = await PredictionDerivatives.new(oracle.address, usdc.address);
    console.log(`   Derivatives: ${derivatives.address}\n`);

    // 4. Fetch real Polymarket data and set up oracle
    console.log("4. Fetching Polymarket data and setting up oracle...");
    const response = await fetch(
        `${CLOB_API}/sampling-markets?limit=10`
    );
    const apiResponse = await response.json();
    const markets = apiResponse.data || [];

    let setupCount = 0;
    for (const market of markets) {
        if (!market.tokens || market.tokens.length < 2 || !market.market_slug) continue;

        try {
            const yesPrice = Math.round(market.tokens[0].price * 10000); // Convert to basis points
            const noPrice = Math.round(market.tokens[1].price * 10000);

            // Skip if prices don't add up properly
            if (yesPrice + noPrice < 9500 || yesPrice + noPrice > 10500) continue;

            const volume = 1000000; // Placeholder since CLOB doesn't have per-market volume
            const liquidity = 1000000; // Placeholder

            console.log(`   Setting up: ${market.market_slug.slice(0, 40)}...`);
            console.log(`   YES: ${(yesPrice / 100).toFixed(1)}% | NO: ${(noPrice / 100).toFixed(1)}%`);

            await oracle.setMarketDataForTesting(
                market.market_slug,
                market.question.slice(0, 100),
                yesPrice,
                noPrice,
                volume.toString(),
                liquidity.toString(),
                { from: deployer }
            );
            setupCount++;

            if (setupCount >= 5) break; // Set up top 5 markets
        } catch (err) {
            console.log(`   Skipping ${market.slug}: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
    }
    console.log(`   Set up ${setupCount} markets\n`);

    // 5. Update frontend wagmi.js
    console.log("5. Updating frontend configuration...");
    const wagmiPath = path.join(__dirname, "../frontend/src/wagmi.js");
    if (fs.existsSync(wagmiPath)) {
        let wagmiContent = fs.readFileSync(wagmiPath, "utf8");

        // Update contract addresses
        wagmiContent = wagmiContent.replace(/derivatives: '[^']+'/, `derivatives: '${derivatives.address}'`);
        wagmiContent = wagmiContent.replace(/oracle: '[^']+'/, `oracle: '${oracle.address}'`);
        wagmiContent = wagmiContent.replace(/usdc: '[^']+'/, `usdc: '${usdc.address}'`);

        fs.writeFileSync(wagmiPath, wagmiContent);
        console.log("   Updated wagmi.js with new addresses\n");
    } else {
        console.log("   wagmi.js not found, skipping frontend update\n");
    }

    // Summary
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  SETUP COMPLETE");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`\nContract Addresses:`);
    console.log(`  USDC:        ${usdc.address}`);
    console.log(`  Oracle:      ${oracle.address}`);
    console.log(`  Derivatives: ${derivatives.address}`);
    console.log(`\nDeployer Address: ${deployer}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Import deployer wallet to MetaMask (or use the same wallet)`);
    console.log(`  2. Refresh the frontend at http://localhost:3000`);
    console.log(`  3. Connect wallet and try opening a position!`);
    console.log(`\nNote: The deployer wallet has 100,000 USDC for testing.`);
    console.log(`      Other wallets can use the + button to mint USDC.\n`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
    });
