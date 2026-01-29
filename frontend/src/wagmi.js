import { http, createConfig } from 'wagmi'
import { metaMask } from 'wagmi/connectors'

// Flare Coston2 Testnet
export const coston2 = {
  id: 114,
  name: 'Flare Coston2',
  nativeCurrency: {
    decimals: 18,
    name: 'Coston2 Flare',
    symbol: 'C2FLR',
  },
  rpcUrls: {
    default: { http: ['https://coston2-api.flare.network/ext/C/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Coston2 Explorer', url: 'https://coston2-explorer.flare.network' },
  },
  testnet: true,
}

// Flare Mainnet
export const flare = {
  id: 14,
  name: 'Flare',
  nativeCurrency: {
    decimals: 18,
    name: 'Flare',
    symbol: 'FLR',
  },
  rpcUrls: {
    default: { http: ['https://flare-api.flare.network/ext/C/rpc'] },
  },
  blockExplorers: {
    default: { name: 'Flare Explorer', url: 'https://flare-explorer.flare.network' },
  },
}

export const config = createConfig({
  chains: [coston2, flare],
  connectors: [
    metaMask({
      dappMetadata: {
        name: 'POLYFLUX',
      },
    }),
  ],
  multiInjectedProviderDiscovery: false,
  transports: {
    [coston2.id]: http(),
    [flare.id]: http(),
  },
})

// Contract addresses on Coston2
export const CONTRACTS = {
  derivatives: '0x3F93bF787eBd273e0c0e4014DC28C1fE9e6c2A7c',
  oracle: '0x5d3e91190AB802470C86c5f43a85ebDAEDE7131f',      // V1 (testnet, owner-only updates)
  oracleV2: '0x5FD1F196c2A1f2880ca707BFEBA503Bb25e8e0C8',   // V2 (production, FDC permissionless)
  usdc: '0x99F3576EC2074174bB308Abf7aA3b207066F294E',
}

// ABIs
export const DERIVATIVES_ABI = [
  {
    name: 'openPosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'string' },
      { name: 'direction', type: 'uint8' },
      { name: 'collateral', type: 'uint256' },
      { name: 'leverage', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'closePosition',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [{ type: 'int256' }],
  },
  {
    name: 'getUserPositions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getPosition',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'marketId', type: 'string' },
          { name: 'direction', type: 'uint8' },
          { name: 'collateral', type: 'uint256' },
          { name: 'leverage', type: 'uint256' },
          { name: 'entryPrice', type: 'uint256' },
          { name: 'size', type: 'uint256' },
          { name: 'openTimestamp', type: 'uint256' },
          { name: 'isOpen', type: 'bool' },
          { name: 'settled', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'calculatePnL',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'positionId', type: 'uint256' }],
    outputs: [{ type: 'int256' }],
  },
  {
    name: 'positions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'marketId', type: 'string' },
      { name: 'direction', type: 'uint8' },
      { name: 'collateral', type: 'uint256' },
      { name: 'size', type: 'uint256' },
      { name: 'entryPrice', type: 'uint256' },
      { name: 'openTimestamp', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
  },
]

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
]

export const ORACLE_ABI = [
  {
    name: 'setMarketDataForTesting',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'marketId', type: 'string' },
      { name: 'question', type: 'string' },
      { name: 'yesPrice', type: 'uint256' },
      { name: 'noPrice', type: 'uint256' },
      { name: 'volume', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'isMarketDataFresh',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'marketId', type: 'string' },
      { name: 'maxAge', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getLatestPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'string' }],
    outputs: [
      { name: 'yesPrice', type: 'uint256' },
      { name: 'noPrice', type: 'uint256' },
    ],
  },
]
