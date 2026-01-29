# POLYFLUX - Prediction Market Derivatives on Flare

POLYFLUX enables leveraged prediction market positions on Flare Network using the Flare Data Connector (FDC) to fetch real-time market data from Polymarket.

## Overview

- **Real-time Polymarket data** via FDC Web2Json attestations
- **Leveraged positions** (up to 5x) on prediction outcomes
- **On-chain settlement** with trustless price feeds
- **Flare Network** native with full EVM compatibility

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌───────────────────┐
│   Polymarket    │────▶│   Flare FDC     │────▶│ POLYFLUX Contracts│
│   Gamma API     │     │   Web2Json      │     │                   │
└─────────────────┘     └─────────────────┘     └───────────────────┘
                                                         │
                                                         ▼
                                                ┌───────────────────┐
                                                │ POLYFLUX Frontend │
                                                └───────────────────┘
```

## Project Structure

```
polyflux/
├── contracts/           # Solidity smart contracts
│   ├── PredictionMarketOracle.sol
│   ├── PredictionDerivatives.sol
│   └── mocks/
├── scripts/            # Deployment & interaction scripts
├── frontend/           # React frontend
└── test/              # Contract tests
```

## Quick Start

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Contracts (Coston2 Testnet)

```bash
npm install
npx hardhat compile
npx hardhat run scripts/fetchMarketData.ts --network coston2
```

## Contracts

### PredictionMarketOracle

Fetches and stores Polymarket prices via FDC Web2Json attestations.

### PredictionDerivatives

Enables leveraged positions on prediction outcomes:
- Long/Short YES or NO outcomes
- 1-5x leverage
- Automatic liquidation at 20% collateral
- Settlement on market resolution

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Flare Mainnet | 14 | https://flare-api.flare.network/ext/C/rpc |
| Coston2 Testnet | 114 | https://coston2-api.flare.network/ext/C/rpc |

## License

MIT
