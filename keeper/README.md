# POLYFLUX FDC Keeper

Permissionless keeper that updates oracle prices and resolves markets via Flare Data Connector (FDC) attestations.

## Overview

The keeper runs two phases each cycle:

**Phase 1 - Market Resolution:**
1. Checks for markets resolved on Polymarket (price at 100%) but not on-chain
2. Fetches FDC proof showing the resolved state
3. Calls `resolveMarketWithProof()` to finalize on-chain

**Phase 2 - Price Updates:**
1. Monitors active markets that need price updates
2. Requests FDC Web2Json attestations for Polymarket data
3. Waits for voting round finalization
4. Retrieves proofs from the DA layer
5. Submits proofs to the oracle contract

Anyone can run this keeper - no special permissions needed.

## Setup

```bash
# Install dependencies
yarn install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
# - PRIVATE_KEY: Any wallet with gas funds
# - ORACLE_ADDRESS: PredictionMarketOracle contract address
```

## Usage

```bash
# Development (with ts-node)
yarn dev

# Production
yarn build
yarn start
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `RPC_URL` | Flare network RPC endpoint | coston2-api.flare.network |
| `PRIVATE_KEY` | Wallet private key for gas | Required |
| `ORACLE_ADDRESS` | Oracle contract address | Required |
| `WEB2JSON_VERIFIER_URL` | FDC Web2Json verifier | fdc-verifiers-testnet.flare.network/verifier/web2 |
| `DA_LAYER_URL` | Data Availability layer | ctn2-data-availability.flare.network |
| `UPDATE_INTERVAL_MS` | Update cycle interval | 600000 (10 min) |

## Project Structure

```
keeper/
├── src/
│   ├── fdc-keeper.ts    # Main keeper service
│   ├── types.ts         # TypeScript type definitions
│   └── utils/
│       ├── core.ts      # Core utilities (hex encoding, sleep, jq transforms)
│       └── fdc.ts       # FDC utilities (attestation, proof retrieval)
├── .env.example         # Environment template
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
└── README.md
```

## FDC Flow

```
Polymarket API → Web2Json Verifier → FdcHub → Voting Round → DA Layer → Oracle
```

1. **Prepare Request**: Build Web2Json attestation request with jq transform
2. **Submit to FdcHub**: Pay fee and submit attestation request
3. **Wait for Finalization**: Voting round must complete
4. **Retrieve Proof**: Get Merkle proof from DA layer
5. **Update Oracle**: Submit proof to oracle contract

## Notes

- The keeper uses `testIgnite` source ID for Web2Json attestations
- Markets with < $1000 liquidity are skipped
- Updates are skipped if market data is fresh (< 1 hour old)
- The keeper handles rate limiting automatically
