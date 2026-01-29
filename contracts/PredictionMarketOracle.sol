// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {IWeb2Json} from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";
import {IFdcVerification} from "@flarenetwork/flare-periphery-contracts/coston2/IFdcVerification.sol";

/**
 * @title PredictionMarketOracle
 * @notice Fetches prediction market data from Polymarket via FDC Web2Json attestations
 * @dev Uses Flare Data Connector to bring off-chain prediction market data on-chain
 *
 * Security features:
 * - All external data must be verified via FDC proof
 * - Price data is bounded to prevent manipulation
 * - Staleness checks prevent use of outdated data
 * - Access control for oracle updates
 */

/// @notice Data structure for a prediction market from Polymarket API
struct MarketData {
    string marketId;
    string question;
    uint256 yesPrice; // Price in basis points (0-10000 = 0-100%)
    uint256 noPrice; // Price in basis points (0-10000 = 0-100%)
    uint256 volume; // Total volume in USD (scaled by 1e6)
    uint256 liquidity; // Current liquidity in USD (scaled by 1e6)
    uint256 timestamp; // When this data was fetched
    uint256 endDate; // Market end/resolution date (unix timestamp)
    bool resolved; // Whether the market has been resolved
    bool outcome; // True = YES won, False = NO won (only valid if resolved)
}

/// @notice Data transport object matching the JQ transformation output
struct MarketDTO {
    string marketId;
    string question;
    uint256 yesPrice;
    uint256 noPrice;
    uint256 volume;
    uint256 liquidity;
}

/**
 * @title IPredictionMarketOracle
 * @notice Interface for the prediction market oracle
 */
interface IPredictionMarketOracle {
    function updateMarketData(IWeb2Json.Proof calldata proof) external;
    function getMarketData(
        string calldata marketId
    ) external view returns (MarketData memory);
    function getLatestPrice(
        string calldata marketId
    ) external view returns (uint256 yesPrice, uint256 noPrice);
    function isMarketDataFresh(
        string calldata marketId,
        uint256 maxAge
    ) external view returns (bool);
    function isMarketResolved(
        string calldata marketId
    ) external view returns (bool);
    function getMarketOutcome(
        string calldata marketId
    ) external view returns (bool resolved, bool outcome);
    function getMarketEndDate(
        string calldata marketId
    ) external view returns (uint256);
}

/**
 * @title PredictionMarketOracle
 * @notice Oracle contract that stores verified prediction market data from Polymarket
 */
contract PredictionMarketOracle is IPredictionMarketOracle {
    // ============ EVENTS ============

    /// @notice Emitted when new market data is stored
    event MarketDataUpdated(
        string indexed marketId,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 volume,
        uint256 timestamp
    );

    /// @notice Emitted when a market is added to the whitelist
    event MarketWhitelisted(string indexed marketId);

    /// @notice Emitted when a market is removed from the whitelist
    event MarketDelisted(string indexed marketId);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    /// @notice Emitted when a market is resolved
    event MarketResolved(
        string indexed marketId,
        bool outcome,
        uint256 finalYesPrice,
        uint256 finalNoPrice
    );

    // ============ CONSTANTS ============

    /// @notice Maximum allowed price in basis points (100%)
    uint256 public constant MAX_PRICE_BPS = 10000;

    /// @notice Minimum liquidity required to accept market data (prevents low-liquidity manipulation)
    uint256 public constant MIN_LIQUIDITY = 1000e6; // $1000 minimum liquidity

    /// @notice Maximum staleness for market data (24 hours)
    uint256 public constant MAX_STALENESS = 24 hours;

    /// @notice Owner address for admin functions
    address public owner;

    /// @notice Mapping of market ID to latest market data
    mapping(string => MarketData) public markets;

    /// @notice Mapping of market ID to whether it's whitelisted
    mapping(string => bool) public whitelistedMarkets;

    /// @notice Array of all market IDs that have been updated
    string[] public marketIds;

    /// @notice Mapping to check if market ID exists in array
    mapping(string => bool) private marketExists;

    /// @notice Modifier to restrict access to owner
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /// @notice Constructor sets the deployer as owner
    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Update market data with a verified Web2Json proof from Polymarket API
     * @param proof The FDC Web2Json proof containing market data
     * @dev The proof must be valid and the market must pass all safety checks
     */
    function updateMarketData(
        IWeb2Json.Proof calldata proof
    ) external override {
        // 1. Verify the FDC proof
        require(_isWeb2JsonProofValid(proof), "Invalid FDC proof");

        // 2. Decode the ABI-encoded data from the proof
        MarketDTO memory dto = abi.decode(
            proof.data.responseBody.abiEncodedData,
            (MarketDTO)
        );

        // 3. Validate the data
        _validateMarketData(dto);

        // 4. Store the market data
        MarketData memory newData = MarketData({
            marketId: dto.marketId,
            question: dto.question,
            yesPrice: dto.yesPrice,
            noPrice: dto.noPrice,
            volume: dto.volume,
            liquidity: dto.liquidity,
            timestamp: block.timestamp,
            endDate: 0, // Will be set separately via setMarketEndDate
            resolved: false,
            outcome: false
        });

        markets[dto.marketId] = newData;

        // Track market IDs
        if (!marketExists[dto.marketId]) {
            marketIds.push(dto.marketId);
            marketExists[dto.marketId] = true;
        }

        emit MarketDataUpdated(
            dto.marketId,
            dto.yesPrice,
            dto.noPrice,
            dto.volume,
            block.timestamp
        );
    }

    /**
     * @notice Get the full market data for a given market ID
     * @param marketId The Polymarket market ID
     * @return The market data struct
     */
    function getMarketData(
        string calldata marketId
    ) external view override returns (MarketData memory) {
        require(markets[marketId].timestamp > 0, "Market not found");
        return markets[marketId];
    }

    /**
     * @notice Get just the latest prices for a market
     * @param marketId The Polymarket market ID
     * @return yesPrice The YES price in basis points
     * @return noPrice The NO price in basis points
     */
    function getLatestPrice(
        string calldata marketId
    ) external view override returns (uint256 yesPrice, uint256 noPrice) {
        MarketData memory data = markets[marketId];
        require(data.timestamp > 0, "Market not found");
        return (data.yesPrice, data.noPrice);
    }

    /**
     * @notice Check if market data is fresh enough
     * @param marketId The Polymarket market ID
     * @param maxAge Maximum allowed age in seconds
     * @return True if the data is fresh
     */
    function isMarketDataFresh(
        string calldata marketId,
        uint256 maxAge
    ) external view override returns (bool) {
        MarketData memory data = markets[marketId];
        if (data.timestamp == 0) return false;
        return (block.timestamp - data.timestamp) <= maxAge;
    }

    /**
     * @notice Get all tracked market IDs
     * @return Array of market IDs
     */
    function getAllMarketIds() external view returns (string[] memory) {
        return marketIds;
    }

    /**
     * @notice Get the number of tracked markets
     * @return The count of markets
     */
    function getMarketCount() external view returns (uint256) {
        return marketIds.length;
    }

    /**
     * @notice Whitelist a market for derivatives trading
     * @param marketId The market ID to whitelist
     */
    function whitelistMarket(string calldata marketId) external onlyOwner {
        whitelistedMarkets[marketId] = true;
        emit MarketWhitelisted(marketId);
    }

    /**
     * @notice Remove a market from the whitelist
     * @param marketId The market ID to delist
     */
    function delistMarket(string calldata marketId) external onlyOwner {
        whitelistedMarkets[marketId] = false;
        emit MarketDelisted(marketId);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @notice Mark a market as resolved with final outcome
     * @param marketId The market ID to resolve
     * @param outcome True if YES won, False if NO won
     * @dev In production, this should be triggered by FDC proof of resolution
     */
    function resolveMarket(
        string calldata marketId,
        bool outcome
    ) external onlyOwner {
        MarketData storage data = markets[marketId];
        require(data.timestamp > 0, "Market not found");
        require(!data.resolved, "Already resolved");

        data.resolved = true;
        data.outcome = outcome;

        // Set final prices (winner = 100%, loser = 0%)
        if (outcome) {
            data.yesPrice = MAX_PRICE_BPS; // 100%
            data.noPrice = 0;
        } else {
            data.yesPrice = 0;
            data.noPrice = MAX_PRICE_BPS; // 100%
        }

        emit MarketResolved(marketId, outcome, data.yesPrice, data.noPrice);
    }

    /**
     * @notice Check if a market has been resolved
     * @param marketId The market ID
     * @return True if resolved
     */
    function isMarketResolved(
        string calldata marketId
    ) external view override returns (bool) {
        return markets[marketId].resolved;
    }

    /**
     * @notice Get the resolution outcome of a market
     * @param marketId The market ID
     * @return resolved Whether the market is resolved
     * @return outcome The outcome (true = YES won) - only valid if resolved
     */
    function getMarketOutcome(
        string calldata marketId
    ) external view override returns (bool resolved, bool outcome) {
        MarketData memory data = markets[marketId];
        return (data.resolved, data.outcome);
    }

    /**
     * @notice Get the end date of a market
     * @param marketId The market ID
     * @return The end date as unix timestamp (0 if not set)
     */
    function getMarketEndDate(
        string calldata marketId
    ) external view override returns (uint256) {
        return markets[marketId].endDate;
    }

    /**
     * @notice Set market end date
     * @param marketId The market ID
     * @param endDate The end date as unix timestamp
     */
    function setMarketEndDate(
        string calldata marketId,
        uint256 endDate
    ) external onlyOwner {
        require(markets[marketId].timestamp > 0, "Market not found");
        markets[marketId].endDate = endDate;
    }

    /**
     * @notice TESTNET ONLY: Set market data directly without FDC proof
     * @dev This function should be removed or disabled before mainnet deployment
     * @param marketId The market identifier
     * @param question The prediction question
     * @param yesPrice YES price in basis points (0-10000)
     * @param noPrice NO price in basis points (0-10000)
     * @param volume Total volume in USD (scaled by 1e6)
     * @param liquidity Current liquidity in USD (scaled by 1e6)
     */
    function setMarketDataForTesting(
        string calldata marketId,
        string calldata question,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 volume,
        uint256 liquidity
    ) external onlyOwner {
        // Validate the data
        MarketDTO memory dto = MarketDTO({
            marketId: marketId,
            question: question,
            yesPrice: yesPrice,
            noPrice: noPrice,
            volume: volume,
            liquidity: liquidity
        });
        _validateMarketData(dto);

        // Store the market data
        markets[marketId] = MarketData({
            marketId: marketId,
            question: question,
            yesPrice: yesPrice,
            noPrice: noPrice,
            volume: volume,
            liquidity: liquidity,
            timestamp: block.timestamp,
            endDate: 0,
            resolved: false,
            outcome: false
        });

        // Track new markets
        if (!marketExists[marketId]) {
            marketIds.push(marketId);
            marketExists[marketId] = true;
        }

        emit MarketDataUpdated(
            marketId,
            yesPrice,
            noPrice,
            volume,
            block.timestamp
        );
    }

    /**
     * @notice Validate market data for safety
     * @param dto The market data to validate
     */
    function _validateMarketData(MarketDTO memory dto) internal pure {
        // Prices must be valid percentages (0-100%)
        require(dto.yesPrice <= MAX_PRICE_BPS, "YES price out of range");
        require(dto.noPrice <= MAX_PRICE_BPS, "NO price out of range");

        // YES + NO should approximately equal 100% (allow 5% tolerance for spread)
        uint256 totalPrice = dto.yesPrice + dto.noPrice;
        require(
            totalPrice >= 9500 && totalPrice <= 10500,
            "Price sum out of range"
        );

        // Minimum liquidity check to prevent low-liquidity manipulation
        require(dto.liquidity >= MIN_LIQUIDITY, "Insufficient liquidity");
    }

    /**
     * @notice Verify a Web2Json proof via FDC
     * @param proof The proof to verify
     * @return True if valid
     */
    function _isWeb2JsonProofValid(
        IWeb2Json.Proof calldata proof
    ) internal view returns (bool) {
        IFdcVerification fdc = ContractRegistry.getFdcVerification();
        return fdc.verifyWeb2Json(proof);
    }

    /**
     * @notice ABI signature helper for generating the correct encoding
     * @dev This function is never called, it just helps tooling generate correct ABI
     */
    function abiSignatureHelper(MarketDTO calldata dto) external pure {}
}
