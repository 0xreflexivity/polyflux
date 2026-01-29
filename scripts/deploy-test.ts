import { web3 } from "hardhat";

const MockERC20 = artifacts.require("MockERC20");
const PredictionMarketOracle = artifacts.require("PredictionMarketOracle");
const PredictionDerivatives = artifacts.require("PredictionDerivatives");

const CLOB_API = "https://clob.polymarket.com";

async function main() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🚀 POLYFLUX Deployment Test on Coston2");
    console.log("═══════════════════════════════════════════════════════════\n");

    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    console.log(`📍 Deployer: ${deployer}`);

    const balance = await web3.eth.getBalance(deployer);
    console.log(`💰 Balance: ${web3.utils.fromWei(balance, "ether")} C2FLR\n`);

    // 1. Deploy Mock USDC
    console.log("1️⃣  Deploying Mock USDC...");
    const usdc = await MockERC20.new("Mock USDC", "USDC", 6);
    console.log(`   ✅ Mock USDC: ${usdc.address}`);
    await usdc.mint(deployer, web3.utils.toBN("100000000000")); // 100,000 USDC with 6 decimals
    console.log(`   💵 Minted 100,000 USDC\n`);

    // 2. Deploy PredictionMarketOracle
    console.log("2️⃣  Deploying PredictionMarketOracle...");
    const oracle = await PredictionMarketOracle.new();
    console.log(`   ✅ Oracle: ${oracle.address}\n`);

    // 3. Deploy PredictionDerivatives
    console.log("3️⃣  Deploying PredictionDerivatives...");
    const derivatives = await PredictionDerivatives.new(oracle.address, usdc.address);
    console.log(`   ✅ Derivatives: ${derivatives.address}\n`);

    // 4. Fetch real Polymarket data
    console.log("4️⃣  Fetching live Polymarket markets...");
    const response = await fetch(
        `${CLOB_API}/markets?limit=5&active=true&closed=false&order=volume24hr&ascending=false`
    );
    const markets = await response.json();

    console.log(`   📊 Top 5 Trending Markets:\n`);
    for (const market of markets.slice(0, 5)) {
        if (!market.outcomePrices) continue;
        const prices = JSON.parse(market.outcomePrices);
        console.log(`   • ${market.question.slice(0, 55)}...`);
        console.log(
            `     YES: ${(parseFloat(prices[0]) * 100).toFixed(1)}¢ | NO: ${(parseFloat(prices[1]) * 100).toFixed(1)}¢`
        );
        console.log(`     Vol: $${(market.volume24hr / 1e6).toFixed(1)}M | Slug: ${market.slug}\n`);
    }

    // 5. Whitelist a market
    const testMarket = markets[0];
    console.log("5️⃣  Whitelisting market...");
    await oracle.whitelistMarket(testMarket.slug);
    console.log(`   ✅ Market "${testMarket.slug}" whitelisted\n`);

    // 6. Test contract reads
    console.log("6️⃣  Testing contract functions...");
    const isWhitelisted = await oracle.whitelistedMarkets(testMarket.slug);
    console.log(`   ✅ whitelistedMarkets("${testMarket.slug.slice(0, 30)}..."): ${isWhitelisted}`);

    const owner = await oracle.owner();
    console.log(`   ✅ Oracle owner: ${owner}`);

    const derivOwner = await derivatives.owner();
    console.log(`   ✅ Derivatives owner: ${derivOwner}`);

    const usdcBalance = await usdc.balanceOf(deployer);
    console.log(`   ✅ USDC balance: ${web3.utils.toBN(usdcBalance).div(web3.utils.toBN(1e6)).toString()} USDC\n`);

    // Summary
    console.log("═══════════════════════════════════════════════════════════");
    console.log("✅ DEPLOYMENT SUCCESSFUL");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`\n📄 Deployed Contracts (Coston2):`);
    console.log(`   Mock USDC:    ${usdc.address}`);
    console.log(`   Oracle:       ${oracle.address}`);
    console.log(`   Derivatives:  ${derivatives.address}`);
    console.log(`\n🔗 Explorer Links:`);
    console.log(`   https://coston2-explorer.flare.network/address/${usdc.address}`);
    console.log(`   https://coston2-explorer.flare.network/address/${oracle.address}`);
    console.log(`   https://coston2-explorer.flare.network/address/${derivatives.address}`);
    console.log(`\n⚠️  Note: FDC verifiers are currently down (526 error).`);
    console.log(`   FDC integration is implemented but requires working verifiers to test.`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Error:", error);
        process.exit(1);
    });
