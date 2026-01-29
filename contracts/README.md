# Prediction Market Derivatives on Flare

Leveraged trading on Polymarket outcomes using Flare's enshrined oracles.

## Overview

This module demonstrates how to use Flare Data Connector (FDC) Web2Json attestations to bring Polymarket prediction market data on-chain and create derivative instruments.

## Architecture

```
┌─────────────────┐      ┌──────────────────┐
│   Polymarket    │      │   Flare Network  │
│   gamma-api     │◄────►│   FDC Web2Json   │
└─────────────────┘      └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │ PredictionMarket │
                         │     Oracle       │
                         └────────┬─────────┘
                                  │
                         ┌────────▼─────────┐
                         │   Prediction     │
                         │   Derivatives    │
                         └──────────────────┘
```

## Contracts

### PredictionMarketOracle.sol

Fetches and stores prediction market data from Polymarket via FDC Web2Json attestations.

**Key Features:**

- Stores verified market data (prices, volume, liquidity)
- Validates price ranges and liquidity minimums
- Staleness checks to prevent using outdated data
- Market whitelisting for risk management

**Data Flow:**

1. Off-chain script fetches Polymarket API
2. FDC verifiers attest to the data
3. Proof is submitted to oracle contract
4. Data is validated and stored on-chain

### PredictionDerivatives.sol

Creates leveraged positions on prediction market outcomes.

**Key Features:**

- Long/Short positions on YES/NO outcomes
- Leverage up to 5x
- Automatic liquidation mechanism
- Protocol fee collection
- ReentrancyGuard protection

**Position Types:**

- `LONG_YES` - Profit when YES price increases
- `LONG_NO` - Profit when NO price increases
- `SHORT_YES` - Profit when YES price decreases
- `SHORT_NO` - Profit when NO price decreases

## Usage

### 1. Fetch Market Data

```bash
yarn hardhat run scripts/predictionMarket/fetchMarketData.ts --network coston2
```

### 2. Open a Position

```typescript
// Approve collateral
await usdc.approve(derivatives.address, collateralAmount);

// Open 2x leveraged long on YES
await derivatives.openPosition(
    "trump-deportation-market", // marketId
    0, // LONG_YES direction
    100e6, // $100 collateral
    20000 // 2x leverage (in BPS)
);
```

### 3. Close Position

```typescript
const pnl = await derivatives.closePosition(positionId);
```

## Security Considerations

1. **Reentrancy Protection**: All state-changing functions use ReentrancyGuard
2. **Oracle Staleness**: Maximum 1 hour staleness for price data
3. **Input Validation**: Price bounds, leverage limits, minimum collateral
4. **Liquidation Safety**: 80% loss threshold with 5% liquidator reward
5. **Access Control**: Owner-only admin functions
6. **Integer Safety**: SafeERC20 for token transfers, overflow-safe math

## Environment Variables

```bash
# Required
PRIVATE_KEY="0x..."
WEB2JSON_VERIFIER_URL_TESTNET="https://fdc-verifiers-testnet.flare.network/verifier/web2"
VERIFIER_API_KEY_TESTNET="00000000-0000-0000-0000-000000000000"
COSTON2_DA_LAYER_URL="https://ctn2-data-availability.flare.network"

# Optional
COSTON2_RPC_URL="https://coston2-api.flare.network/ext/C/rpc"
```

## API Reference

### Polymarket Gamma API

```
GET https://gamma-api.polymarket.com/markets?slug={slug}
```

Response format:

```json
{
    "id": "517311",
    "question": "Will Trump deport 250,000-500,000 people?",
    "outcomePrices": "[\"0.887\", \"0.113\"]",
    "volumeNum": 1062083.46,
    "liquidityNum": 6014.36
}
```

### JQ Transformation

The Web2Json attestation uses this JQ transformation:

```jq
.[0] | {
    marketId: .slug,
    question: .question,
    yesPrice: ((.outcomePrices | fromjson)[0] | tonumber * 10000 | floor),
    noPrice: ((.outcomePrices | fromjson)[1] | tonumber * 10000 | floor),
    volume: (.volumeNum * 1000000 | floor),
    liquidity: (.liquidityNum * 1000000 | floor)
}
```

## Testing

```bash
# Run all tests
yarn hardhat test test/predictionMarket/*.ts

# Run with coverage
yarn hardhat coverage --testfiles "test/predictionMarket/*.ts"
```

## Future Enhancements

1. **Multi-Market Strategies**: Combine positions across multiple markets
2. **Options-like Products**: Binary options on prediction outcomes
3. **Automated Market Making**: LP positions on prediction spreads
4. **Cross-Protocol Integration**: Combine with FTSO price feeds
5. **Additional Sources**: Kalshi, Metaculus, etc.

## License

MIT
