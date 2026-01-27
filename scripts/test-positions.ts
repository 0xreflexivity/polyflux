import { ethers } from "hardhat";

const GAMMA_API = "https://gamma-api.polymarket.com";

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🚀 FLUX Position Test on Coston2");
  console.log("═══════════════════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log(`📍 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} C2FLR\n`);

  // 1. Deploy contracts
  console.log("1️⃣  Deploying contracts...");
  
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`   USDC: ${usdcAddr}`);

  const Oracle = await ethers.getContractFactory("PredictionMarketOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`   Oracle: ${oracleAddr}`);

  const Derivatives = await ethers.getContractFactory("PredictionDerivatives");
  const derivatives = await Derivatives.deploy(oracleAddr, usdcAddr);
  await derivatives.waitForDeployment();
  const derivativesAddr = await derivatives.getAddress();
  console.log(`   Derivatives: ${derivativesAddr}\n`);

  // 2. Mint USDC
  console.log("2️⃣  Minting test USDC...");
  const mintTx = await usdc.mint(deployer.address, ethers.parseUnits("10000", 6));
  await mintTx.wait();
  const usdcBal = await usdc.balanceOf(deployer.address);
  console.log(`   Balance: ${ethers.formatUnits(usdcBal, 6)} USDC\n`);

  // 3. Use a simple test market
  const marketId = "test-market-btc-100k";
  const question = "Will Bitcoin reach $100,000?";
  const yesPrice = 6500;  // 65%
  const noPrice = 3500;   // 35%
  const volume = 10000000 * 1e6;  // $10M
  const liquidity = 2000000 * 1e6;  // $2M
  
  console.log("3️⃣  Setting up test market...");
  console.log(`   Market: ${question}`);
  console.log(`   YES: ${yesPrice / 100}% | NO: ${noPrice / 100}%\n`);

  // 4. Whitelist and set market data
  console.log("4️⃣  Whitelisting and setting market data...");
  const wlTx = await oracle.whitelistMarket(marketId);
  await wlTx.wait();
  console.log(`   ✅ Market whitelisted`);
  
  const setDataTx = await oracle.setMarketDataForTesting(
    marketId,
    question,
    yesPrice,
    noPrice,
    volume,
    liquidity
  );
  await setDataTx.wait();
  console.log(`   ✅ Market data set\n`);

  // Verify data
  const marketData = await oracle.getMarketData(marketId);
  console.log(`   Stored: YES=${Number(marketData.yesPrice)/100}%, NO=${Number(marketData.noPrice)/100}%`);
  
  const isFresh = await oracle.isMarketDataFresh(marketId, 3600);
  console.log(`   Fresh (1hr): ${isFresh}\n`);

  // 5. Approve USDC
  console.log("5️⃣  Approving USDC...");
  const approveTx = await usdc.approve(derivativesAddr, ethers.parseUnits("10000", 6));
  await approveTx.wait();
  console.log(`   ✅ USDC approved\n`);

  // 6. Open positions
  console.log("6️⃣  Opening positions...\n");

  // Position 1: LONG YES (100 USDC @ 2x)
  console.log("   📈 Position 1: LONG YES");
  console.log(`      Collateral: 100 USDC, Leverage: 2x`);
  
  try {
    const tx1 = await derivatives.openPosition(
      marketId,
      0, // LONG_YES
      ethers.parseUnits("100", 6),
      20000 // 2x
    );
    const receipt1 = await tx1.wait();
    console.log(`      ✅ Success! Tx: ${receipt1?.hash?.slice(0, 20)}...`);
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
      ethers.parseUnits("50", 6),
      30000 // 3x
    );
    const receipt2 = await tx2.wait();
    console.log(`      ✅ Success! Tx: ${receipt2?.hash?.slice(0, 20)}...`);
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
      ethers.parseUnits("75", 6),
      15000 // 1.5x
    );
    const receipt3 = await tx3.wait();
    console.log(`      ✅ Success! Tx: ${receipt3?.hash?.slice(0, 20)}...`);
  } catch (e: any) {
    console.log(`      ❌ Error: ${e.message?.slice(0, 100)}`);
  }

  // 7. Check positions
  console.log("\n7️⃣  Checking positions...");
  const positions = await derivatives.getUserPositions(deployer.address);
  console.log(`   Total positions: ${positions.length}\n`);

  const directions = ["LONG_YES", "LONG_NO", "SHORT_YES", "SHORT_NO"];
  
  for (const posId of positions) {
    const pos = await derivatives.positions(posId);
    console.log(`   Position #${posId}:`);
    console.log(`   - Direction: ${directions[Number(pos.direction)]}`);
    console.log(`   - Collateral: ${ethers.formatUnits(pos.collateral, 6)} USDC`);
    console.log(`   - Size: ${ethers.formatUnits(pos.size, 6)} USDC`);
    console.log(`   - Entry: ${Number(pos.entryPrice) / 100}%\n`);
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅ TEST COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\n🔗 Derivatives: ${derivativesAddr}`);
  console.log(`   https://coston2-explorer.flare.network/address/${derivativesAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Fatal Error:", error.message);
    process.exit(1);
  });
