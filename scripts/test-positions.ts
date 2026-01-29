import { web3 } from "hardhat";

const MockERC20 = artifacts.require("MockERC20");
const PredictionMarketOracle = artifacts.require("PredictionMarketOracle");
const PredictionDerivatives = artifacts.require("PredictionDerivatives");

async function main() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🚀 POLYFLUX Position Test on Coston2");
    console.log("═══════════════════════════════════════════════════════════\n");

    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    console.log(`📍 Deployer: ${deployer}`);

    const balance = await web3.eth.getBalance(deployer);
    console.log(`💰 Balance: ${web3.utils.fromWei(balance, "ether")} C2FLR\n`);

    // 1. Deploy contracts
    console.log("1️⃣  Deploying contracts...");

    const usdc = await MockERC20.new("Mock USDC", "USDC", 6);
    console.log(`   USDC: ${usdc.address}`);

    const oracle = await PredictionMarketOracle.new();
    console.log(`   Oracle: ${oracle.address}`);

    const derivatives = await PredictionDerivatives.new(oracle.address, usdc.address);
    console.log(`   Derivatives: ${derivatives.address}\n`);

    // 2. Mint USDC
    console.log("2️⃣  Minting test USDC...");
    await usdc.mint(deployer, web3.utils.toBN("10000000000")); // 10,000 USDC with 6 decimals
    const usdcBal = await usdc.balanceOf(deployer);
    console.log(`   Balance: ${web3.utils.toBN(usdcBal).div(web3.utils.toBN(1e6)).toString()} USDC\n`);

    // 3. Use a simple test market
    const marketId = "test-market-btc-100k";
    const question = "Will Bitcoin reach $100,000?";
    const yesPrice = 6500; // 65%
    const noPrice = 3500; // 35%
    const volume = "10000000000000"; // $10M * 1e6
    const liquidity = "2000000000000"; // $2M * 1e6

    console.log("3️⃣  Setting up test market...");
    console.log(`   Market: ${question}`);
    console.log(`   YES: ${yesPrice / 100}% | NO: ${noPrice / 100}%\n`);

    // 4. Whitelist and set market data
    console.log("4️⃣  Whitelisting and setting market data...");
    await oracle.whitelistMarket(marketId, { from: deployer });
    console.log(`   ✅ Market whitelisted`);

    await oracle.setMarketDataForTesting(marketId, question, yesPrice, noPrice, volume, liquidity, { from: deployer });
    console.log(`   ✅ Market data set\n`);

    // Verify data
    const marketData = await oracle.getMarketData(marketId);
    console.log(`   Stored: YES=${Number(marketData.yesPrice) / 100}%, NO=${Number(marketData.noPrice) / 100}%`);

    const isFresh = await oracle.isMarketDataFresh(marketId, 3600);
    console.log(`   Fresh (1hr): ${isFresh}\n`);

    // 5. Approve USDC
    console.log("5️⃣  Approving USDC...");
    await usdc.approve(derivatives.address, web3.utils.toBN("10000000000"), { from: deployer }); // 10,000 USDC
    console.log(`   ✅ USDC approved\n`);

    // 6. Open positions
    console.log("6️⃣  Opening positions...\n");

    const collateral100 = web3.utils.toBN("100000000"); // 100 USDC with 6 decimals
    const collateral50 = web3.utils.toBN("50000000"); // 50 USDC
    const collateral75 = web3.utils.toBN("75000000"); // 75 USDC

    // Position 1: LONG YES (100 USDC @ 2x)
    console.log("   📈 Position 1: LONG YES");
    console.log(`      Collateral: 100 USDC, Leverage: 2x`);

    try {
        const tx1 = await derivatives.openPosition(
            marketId,
            0, // LONG_YES
            collateral100,
            20000, // 2x leverage
            { from: deployer }
        );
        console.log(`      ✅ Success! Tx: ${tx1.tx.slice(0, 20)}...`);
    } catch (e: any) {
        console.log(`      ❌ Error: ${e.message?.slice(0, 100)}`);
    }

    // Position 2: LONG NO (50 USDC @ 3x)
    console.log("\n   📉 Position 2: LONG NO");
    console.log(`      Collateral: 50 USDC, Leverage: 3x`);

    try {
        const tx2 = await derivatives.openPosition(
            marketId,
            1, // LONG_NO
            collateral50,
            30000, // 3x leverage
            { from: deployer }
        );
        console.log(`      ✅ Success! Tx: ${tx2.tx.slice(0, 20)}...`);
    } catch (e: any) {
        console.log(`      ❌ Error: ${e.message?.slice(0, 100)}`);
    }

    // Position 3: SHORT YES (75 USDC @ 1.5x)
    console.log("\n   📊 Position 3: SHORT YES");
    console.log(`      Collateral: 75 USDC, Leverage: 1.5x`);

    try {
        const tx3 = await derivatives.openPosition(
            marketId,
            2, // SHORT_YES
            collateral75,
            15000, // 1.5x leverage
            { from: deployer }
        );
        console.log(`      ✅ Success! Tx: ${tx3.tx.slice(0, 20)}...`);
    } catch (e: any) {
        console.log(`      ❌ Error: ${e.message?.slice(0, 100)}`);
    }

    // 7. Check positions
    console.log("\n7️⃣  Checking positions...");
    const positions = await derivatives.getUserPositions(deployer);
    console.log(`   Total positions: ${positions.length}\n`);

    const directions = ["LONG_YES", "LONG_NO", "SHORT_YES", "SHORT_NO"];

    for (const posId of positions) {
        const pos = await derivatives.positions(posId);
        console.log(`   Position #${posId}:`);
        console.log(`   - Direction: ${directions[Number(pos.direction)]}`);
        console.log(`   - Collateral: ${web3.utils.toBN(pos.collateral).div(web3.utils.toBN(1e6)).toString()} USDC`);
        console.log(`   - Size: ${web3.utils.toBN(pos.size).div(web3.utils.toBN(1e6)).toString()} USDC`);
        console.log(`   - Entry: ${Number(pos.entryPrice) / 100}%\n`);
    }

    // Summary
    console.log("═══════════════════════════════════════════════════════════");
    console.log("✅ TEST COMPLETE");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`\n🔗 Derivatives: ${derivatives.address}`);
    console.log(`   https://coston2-explorer.flare.network/address/${derivatives.address}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Fatal Error:", error.message);
        process.exit(1);
    });
