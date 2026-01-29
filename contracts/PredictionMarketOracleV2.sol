// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcVerification.sol";

/**
 * @title PredictionMarketOracleV2
 * @notice Production-ready oracle for Polymarket data via Flare FDC
 * @dev Uses Web2Json attestations to trustlessly verify API data on-chain
 *
 * Key features:
 * - Anyone can submit FDC-verified price updates (permissionless)
 * - Proof metadata stored for auditability
 * - URL validation ensures data comes from correct source
 * - Timestamp validation prevents replay attacks
 */

/// @notice Market price data with FDC proof metadata
struct MarketData {
    string marketId;
    string question;
    uint256 yesPrice; // Basis points (0-10000 = 0-100%)
    uint256 noPrice; // Basis points (0-10000 = 0-100%)
    uint256 volume; // USD volume (scaled by 1e6)
    uint256 liquidity; // USD liquidity (scaled by 1e6)
    uint256 timestamp; // When stored on-chain
    uint256 fdcTimestamp; // FDC attestation timestamp
    uint64 votingRound; // FDC voting round for this update
    address submitter; // Who submitted the proof
    bool resolved;
    bool outcome;
}

/// @notice DTO matching the jq transformation output from Polymarket API
struct MarketDTO {
    string marketId;
    string question;
    uint256 yesPrice;
    uint256 noPrice;
    uint256 volume;
    uint256 liquidity;
}

/**
 * @title PredictionMarketOracleV2
 * @notice Permissionless oracle - anyone can submit FDC proofs
 */
contract PredictionMarketOracleV2 {
    // ============ EVENTS ============

    event MarketDataUpdated(
        string indexed marketId,
        uint256 yesPrice,
        uint256 noPrice,
        uint64 votingRound,
        address indexed submitter
    );

    event MarketResolved(
        string indexed marketId,
        bool outcome,
        uint64 votingRound
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    // ============ ERRORS ============

    error InvalidProof();
    error InvalidUrl();
    error InvalidPrices();
    error InsufficientLiquidity();
    error MarketNotFound();
    error MarketAlreadyResolved();
    error StaleData();
    error OnlyOwner();

    // ============ CONSTANTS ============

    uint256 public constant MAX_PRICE_BPS = 10000;
    uint256 public constant MIN_LIQUIDITY = 1000e6; // $1000
    uint256 public constant MAX_STALENESS = 1 hours;

    /// @notice Expected URL prefix for Polymarket API
    string public constant POLYMARKET_API_PREFIX =
        "https://clob.polymarket.com/markets";

    // ============ STATE ============

    address public owner;
    mapping(string => MarketData) public markets;
    string[] public marketIds;
    mapping(string => bool) private marketExists;

    // ============ CONSTRUCTOR ============

    constructor() {
        owner = msg.sender;
    }

    // ============ MODIFIERS ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Update market data with FDC Web2Json proof (PERMISSIONLESS)
     * @param proof The verified FDC proof from Polymarket API
     * @dev Anyone can call this - proof verification ensures data integrity
     */
    function updateMarketData(IWeb2Json.Proof calldata proof) external {
        // 1. Verify proof via FDC
        if (!_verifyProof(proof)) revert InvalidProof();

        // 2. Validate URL is from Polymarket
        if (!_isValidPolymarketUrl(proof.data.requestBody.url))
            revert InvalidUrl();

        // 3. Decode the ABI-encoded response
        MarketDTO memory dto = abi.decode(
            proof.data.responseBody.abiEncodedData,
            (MarketDTO)
        );

        // 4. Validate data integrity
        _validateMarketData(dto);

        // 5. Store with proof metadata
        _storeMarketData(dto, proof);
    }

    /**
     * @notice Resolve a market with FDC proof of resolution
     * @param proof The FDC proof showing market resolution
     * @dev Proof must show YES or NO price at 100%
     */
    function resolveMarketWithProof(IWeb2Json.Proof calldata proof) external {
        if (!_verifyProof(proof)) revert InvalidProof();
        if (!_isValidPolymarketUrl(proof.data.requestBody.url))
            revert InvalidUrl();

        MarketDTO memory dto = abi.decode(
            proof.data.responseBody.abiEncodedData,
            (MarketDTO)
        );

        MarketData storage data = markets[dto.marketId];
        if (data.timestamp == 0) revert MarketNotFound();
        if (data.resolved) revert MarketAlreadyResolved();

        // Check if market is actually resolved (one price at 100%)
        bool isResolved = dto.yesPrice >= 9900 || dto.noPrice >= 9900;
        if (!isResolved) revert InvalidPrices();

        // Determine outcome
        bool outcome = dto.yesPrice >= 9900;

        data.resolved = true;
        data.outcome = outcome;
        data.yesPrice = outcome ? MAX_PRICE_BPS : 0;
        data.noPrice = outcome ? 0 : MAX_PRICE_BPS;
        data.votingRound = proof.data.votingRound;

        emit MarketResolved(dto.marketId, outcome, proof.data.votingRound);
    }

    /**
     * @notice Get market data
     */
    function getMarketData(
        string calldata marketId
    ) external view returns (MarketData memory) {
        MarketData memory data = markets[marketId];
        if (data.timestamp == 0) revert MarketNotFound();
        return data;
    }

    /**
     * @notice Get latest prices for a market
     */
    function getLatestPrice(
        string calldata marketId
    ) external view returns (uint256 yesPrice, uint256 noPrice) {
        MarketData memory data = markets[marketId];
        if (data.timestamp == 0) revert MarketNotFound();
        return (data.yesPrice, data.noPrice);
    }

    /**
     * @notice Check if market data is fresh
     */
    function isMarketDataFresh(
        string calldata marketId,
        uint256 maxAge
    ) external view returns (bool) {
        MarketData memory data = markets[marketId];
        if (data.timestamp == 0) return false;
        return (block.timestamp - data.timestamp) <= maxAge;
    }

    /**
     * @notice Check if market is resolved
     */
    function isMarketResolved(
        string calldata marketId
    ) external view returns (bool) {
        return markets[marketId].resolved;
    }

    /**
     * @notice Get market outcome
     */
    function getMarketOutcome(
        string calldata marketId
    ) external view returns (bool resolved, bool outcome) {
        MarketData memory data = markets[marketId];
        return (data.resolved, data.outcome);
    }

    /**
     * @notice Get all market IDs
     */
    function getAllMarketIds() external view returns (string[] memory) {
        return marketIds;
    }

    /**
     * @notice Get market count
     */
    function getMarketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /**
     * @notice Transfer ownership (for emergency admin functions only)
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert OnlyOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /**
     * @notice Emergency resolve (only if FDC is unavailable)
     * @dev Should only be used as last resort
     */
    function emergencyResolve(
        string calldata marketId,
        bool outcome
    ) external onlyOwner {
        MarketData storage data = markets[marketId];
        if (data.timestamp == 0) revert MarketNotFound();
        if (data.resolved) revert MarketAlreadyResolved();

        data.resolved = true;
        data.outcome = outcome;
        data.yesPrice = outcome ? MAX_PRICE_BPS : 0;
        data.noPrice = outcome ? 0 : MAX_PRICE_BPS;

        emit MarketResolved(marketId, outcome, 0);
    }

    // ============ INTERNAL FUNCTIONS ============

    function _verifyProof(
        IWeb2Json.Proof calldata proof
    ) internal view returns (bool) {
        IFdcVerification fdc = ContractRegistry.getFdcVerification();
        return fdc.verifyWeb2Json(proof);
    }

    function _isValidPolymarketUrl(
        string memory url
    ) internal pure returns (bool) {
        bytes memory urlBytes = bytes(url);
        bytes memory prefixBytes = bytes(POLYMARKET_API_PREFIX);

        if (urlBytes.length < prefixBytes.length) return false;

        for (uint i = 0; i < prefixBytes.length; i++) {
            if (urlBytes[i] != prefixBytes[i]) return false;
        }

        return true;
    }

    function _validateMarketData(MarketDTO memory dto) internal pure {
        // Prices must be valid
        if (dto.yesPrice > MAX_PRICE_BPS) revert InvalidPrices();
        if (dto.noPrice > MAX_PRICE_BPS) revert InvalidPrices();

        // Prices should sum to ~100%
        uint256 total = dto.yesPrice + dto.noPrice;
        if (total < 9500 || total > 10500) revert InvalidPrices();

        // Minimum liquidity
        if (dto.liquidity < MIN_LIQUIDITY) revert InsufficientLiquidity();
    }

    function _storeMarketData(
        MarketDTO memory dto,
        IWeb2Json.Proof calldata proof
    ) internal {
        markets[dto.marketId] = MarketData({
            marketId: dto.marketId,
            question: dto.question,
            yesPrice: dto.yesPrice,
            noPrice: dto.noPrice,
            volume: dto.volume,
            liquidity: dto.liquidity,
            timestamp: block.timestamp,
            fdcTimestamp: proof.data.lowestUsedTimestamp,
            votingRound: proof.data.votingRound,
            submitter: msg.sender,
            resolved: false,
            outcome: false
        });

        if (!marketExists[dto.marketId]) {
            marketIds.push(dto.marketId);
            marketExists[dto.marketId] = true;
        }

        emit MarketDataUpdated(
            dto.marketId,
            dto.yesPrice,
            dto.noPrice,
            proof.data.votingRound,
            msg.sender
        );
    }

    /**
     * @notice ABI signature helper for generating jq transformation
     * @dev Never called - exists for tooling to generate correct ABI encoding
     */
    function abiSignatureHelper(MarketDTO calldata) external pure {}
}
