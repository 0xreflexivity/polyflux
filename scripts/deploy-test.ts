import { ethers } from "hardhat";

const GAMMA_API = "https://gamma-api.polymarket.com";

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🚀 FLUX Deployment Test on Coston2");
  console.log("═══════════════════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log(`📍 Deployer: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} C2FLR\n`);

  // 1. Deploy Mock USDC
  console.log("1️⃣  Deploying Mock USDC...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20.deploy("Mock USDC", "USDC", 6);
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`   ✅ Mock USDC: ${usdcAddr}`);
  await usdc.mint(deployer.address, ethers.parseUnits("100000", 6));
  console.log(`   💵 Minted 100,000 USDC\n`);

  // 2. Deploy PredictionMarketOracle
  console.log("2️⃣  Deploying PredictionMarketOracle...");
  const Oracle = await ethers.getContractFactory("PredictionMarketOracle");
  const oracle = await Oracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`   ✅ Oracle: ${oracleAddr}\n`);

  // 3. Deploy PredictionDerivatives
  console.log("3️⃣  Deploying PredictionDerivatives...");
  const Derivatives = await ethers.getContractFactory("PredictionDerivatives");
  const derivatives = await Derivatives.deploy(oracleAddr, usdcAddr);
  await derivatives.waitForDeployment();
  const derivativesAddr = await derivatives.getAddress();
  console.log(`   ✅ Derivatives: ${derivativesAddr}\n`);

  // 4. Fetch real Polymarket data
  console.log("4️⃣  Fetching live Polymarket markets...");
  const response = await fetch(`${GAMMA_API}/markets?limit=5&active=true&closed=false&order=volume24hr&ascending=false`);
  const markets = await response.json();
  
  console.log(`   📊 Top 5 Trending Markets:\n`);
  for (const market of markets.slice(0, 5)) {
    if (!market.outcomePrices) continue;
    const prices = JSON.parse(market.outcomePrices);
    console.log(`   • ${market.question.slice(0, 55)}...`);
    console.log(`     YES: ${(parseFloat(prices[0]) * 100).toFixed(1)}¢ | NO: ${(parseFloat(prices[1]) * 100).toFixed(1)}¢`);
    console.log(`     Vol: $${(market.volume24hr / 1e6).toFixed(1)}M | Slug: ${market.slug}\n`);
  }

  // 5. Whitelist a market
  const testMarket = markets[0];
  console.log("5️⃣  Whitelisting market...");
  const whitelistTx = await oracle.whitelistMarket(testMarket.slug);
  await whitelistTx.wait();
  console.log(`   ✅ Market "${testMarket.slug}" whitelisted\n`);

  // 6. Test contract reads
  console.log("6️⃣  Testing contract functions...");
  const isWhitelisted = await oracle.whitelistedMarkets(testMarket.slug);
  console.log(`   ✅ whitelistedMarkets("${testMarket.slug.slice(0, 30)}..."): ${isWhitelisted}`);
  
  const owner = await oracle.owner();
  console.log(`   ✅ Oracle owner: ${owner}`);
  
  const derivOwner = await derivatives.owner();
  console.log(`   ✅ Derivatives owner: ${derivOwner}`);
  
  const usdcBalance = await usdc.balanceOf(deployer.address);
  console.log(`   ✅ USDC balance: ${ethers.formatUnits(usdcBalance, 6)} USDC\n`);

  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅ DEPLOYMENT SUCCESSFUL");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\n📄 Deployed Contracts (Coston2):`);
  console.log(`   Mock USDC:    ${usdcAddr}`);
  console.log(`   Oracle:       ${oracleAddr}`);
  console.log(`   Derivatives:  ${derivativesAddr}`);
  console.log(`\n🔗 Explorer Links:`);
  console.log(`   https://coston2-explorer.flare.network/address/${usdcAddr}`);
  console.log(`   https://coston2-explorer.flare.network/address/${oracleAddr}`);
  console.log(`   https://coston2-explorer.flare.network/address/${derivativesAddr}`);
  console.log(`\n⚠️  Note: FDC verifiers are currently down (526 error).`);
  console.log(`   FDC integration is implemented but requires working verifiers to test.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
