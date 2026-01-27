import { ethers } from "hardhat";

const GAMMA_API = "https://gamma-api.polymarket.com";

// FDC Configuration
const WEB2JSON_VERIFIER_URL = process.env.WEB2JSON_VERIFIER_URL_TESTNET || "https://web2json-verifier-test.flare.rocks";
const VERIFIER_API_KEY = process.env.VERIFIER_API_KEY_TESTNET || "00000000-0000-0000-0000-000000000000";
const DA_LAYER_URL = process.env.COSTON2_DA_LAYER_URL || "https://ctn2-data-availability.flare.network";

// Flare system contract addresses on Coston2
const FDC_HUB_ADDRESS = "0x52e1CFE18BD55bb8d885d463DC26D9C365cd316B";

interface PolymarketMarket {
  id: string;
  slug: string;
  question: string;
  outcomePrices: string;
  volume24hr: number;
  volumeNum: number;
  liquidityNum: number;
}

async function fetchTopMarkets(): Promise<PolymarketMarket[]> {
  const response = await fetch(
    `${GAMMA_API}/markets?limit=5&active=true&closed=false&order=volume24hr&ascending=false`
  );
  const data = await response.json();
  return data.filter((m: any) => m.outcomePrices && m.question && m.slug);
}

async function prepareAttestationRequest(marketSlug: string): Promise<any> {
  const apiUrl = `https://gamma-api.polymarket.com/markets?slug=${marketSlug}`;
  
  const postProcessJq = `
.[0] | {
    marketId: .slug,
    question: .question,
    yesPrice: ((.outcomePrices | fromjson)[0] | tonumber * 10000 | floor),
    noPrice: ((.outcomePrices | fromjson)[1] | tonumber * 10000 | floor),
    volume: (.volumeNum * 1000000 | floor),
    liquidity: (.liquidityNum * 1000000 | floor)
}
`.trim();

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

  const requestBody = {
    url: apiUrl,
    httpMethod: "GET",
    headers: "{}",
    queryParams: "{}",
    body: "{}",
    postProcessJq: postProcessJq,
    abiSignature: abiSignature,
  };

  const response = await fetch(`${WEB2JSON_VERIFIER_URL}/Web2Json/prepareRequest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": VERIFIER_API_KEY,
    },
    body: JSON.stringify({
      attestationType: "0x5765623247736f6e000000000000000000000000000000000000000000000000", // Web2Json
      sourceId: "0x5075626c69635765623200000000000000000000000000000000000000000000", // PublicWeb2
      requestBody: requestBody,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to prepare attestation: ${response.statusText}`);
  }

  return response.json();
}

async function submitAttestationToFdc(abiEncodedRequest: string, deployer: any): Promise<number> {
  // FdcHub ABI (minimal)
  const fdcHubAbi = [
    "function requestAttestation(bytes calldata data) external payable returns (bool)",
    "function getCurrentRound() external view returns (uint256)",
  ];
  
  const fdcHub = new ethers.Contract(FDC_HUB_ADDRESS, fdcHubAbi, deployer);
  
  // Get current round
  const currentRound = await fdcHub.getCurrentRound();
  console.log(`   Current FDC round: ${currentRound}`);
  
  // Submit attestation request (with fee)
  const fee = ethers.parseEther("0.5"); // 0.5 C2FLR fee
  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  await tx.wait();
  
  console.log(`   Attestation submitted in round: ${Number(currentRound) + 1}`);
  return Number(currentRound) + 1;
}

async function waitForProof(abiEncodedRequest: string, roundId: number, maxRetries = 30): Promise<any> {
  console.log(`   Waiting for round ${roundId} finalization...`);
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${DA_LAYER_URL}/api/v1/fdc/proof-by-request-round-raw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request: abiEncodedRequest,
          roundId: roundId,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.proof && data.response_hex) {
          return data;
        }
      }
    } catch (e) {
      // Continue retrying
    }
    
    // Wait 10 seconds between retries
    await new Promise(resolve => setTimeout(resolve, 10000));
    process.stdout.write(`   Retry ${i + 1}/${maxRetries}...\r`);
  }
  
  throw new Error("Timeout waiting for FDC proof");
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🚀 FLUX E2E Test on Coston2 with Real FDC Attestations");
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
  const markets = await fetchTopMarkets();
  const testMarket = markets[0];
  
  const prices = JSON.parse(testMarket.outcomePrices);
  console.log(`   📊 Selected: ${testMarket.question.slice(0, 50)}...`);
  console.log(`      Slug: ${testMarket.slug}`);
  console.log(`      YES: ${(parseFloat(prices[0]) * 100).toFixed(1)}¢`);
  console.log(`      NO: ${(parseFloat(prices[1]) * 100).toFixed(1)}¢`);
  console.log(`      Volume: $${(testMarket.volume24hr / 1e6).toFixed(1)}M\n`);

  // 5. Whitelist market
  console.log("5️⃣  Whitelisting market on oracle...");
  await oracle.whitelistMarket(testMarket.slug);
  console.log(`   ✅ Market "${testMarket.slug}" whitelisted\n`);

  // 6. Prepare FDC attestation request
  console.log("6️⃣  Preparing FDC Web2Json attestation...");
  const attestationData = await prepareAttestationRequest(testMarket.slug);
  console.log(`   ✅ Attestation request prepared\n`);

  // 7. Submit to FdcHub
  console.log("7️⃣  Submitting to FdcHub...");
  const roundId = await submitAttestationToFdc(attestationData.abiEncodedRequest, deployer);
  console.log(`   ✅ Submitted to round ${roundId}\n`);

  // 8. Wait for proof
  console.log("8️⃣  Waiting for FDC proof (this may take 2-3 minutes)...");
  const proof = await waitForProof(attestationData.abiEncodedRequest, roundId);
  console.log(`   ✅ Proof received!\n`);

  // 9. Submit proof to oracle
  console.log("9️⃣  Updating market data on-chain...");
  
  // Decode the response for the contract
  const responseData = ethers.AbiCoder.defaultAbiCoder().decode(
    ["tuple(bytes32 attestationType, bytes32 sourceId, uint64 timestampSeconds, tuple(string marketId, string question, uint256 yesPrice, uint256 noPrice, uint256 volume, uint256 liquidity) responseBody)"],
    proof.response_hex
  );
  
  const updateTx = await oracle.updateMarketData({
    merkleProof: proof.proof,
    data: responseData[0],
  });
  await updateTx.wait();
  console.log(`   ✅ Market data updated on-chain!\n`);

  // 10. Open a position
  console.log("🔟 Opening leveraged position...");
  const collateral = ethers.parseUnits("1000", 6);
  await usdc.approve(derivativesAddr, collateral);
  
  const openTx = await derivatives.openPosition(
    testMarket.slug,
    0, // LONG_YES
    collateral,
    20000 // 2x leverage
  );
  await openTx.wait();
  console.log(`   ✅ Position opened: 1000 USDC @ 2x on YES\n`);

  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅ E2E TEST COMPLETE - ALL SYSTEMS OPERATIONAL");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\n📄 Deployed Contracts:`);
  console.log(`   Mock USDC:    ${usdcAddr}`);
  console.log(`   Oracle:       ${oracleAddr}`);
  console.log(`   Derivatives:  ${derivativesAddr}`);
  console.log(`\n🔗 Explorer: https://coston2-explorer.flare.network/address/${derivativesAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
