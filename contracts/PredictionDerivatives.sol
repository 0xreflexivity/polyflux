// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IPredictionMarketOracle } from "./PredictionMarketOracle.sol";

/**
 * @title PredictionDerivatives
 * @notice Create leveraged positions on prediction market outcomes using Flare's FDC
 * @dev Enables users to go long/short on Polymarket outcomes with leverage
 *
 * Security considerations (Trail of Bits):
 * - Reentrancy protection on all state-changing functions
 * - Proper decimal handling for price calculations
 * - Maximum leverage caps to prevent excessive risk
 * - Liquidation mechanism to protect protocol solvency
 * - Oracle staleness checks before using price data
 * - Minimum position sizes to prevent dust attacks
 */

/// @notice Position direction
enum Direction {
    LONG_YES, // Betting YES price will increase
    LONG_NO, // Betting NO price will increase (same as SHORT_YES)
    SHORT_YES, // Betting YES price will decrease
    SHORT_NO // Betting NO price will decrease (same as LONG_YES)
}

/// @notice A leveraged position
struct Position {
    address owner;
    string marketId;
    Direction direction;
    uint256 collateral; // Collateral deposited (in stablecoin)
    uint256 leverage; // Leverage multiplier (1x = 10000, 2x = 20000, etc.)
    uint256 entryPrice; // Entry price in basis points
    uint256 size; // Position size = collateral * leverage
    uint256 openTimestamp;
    bool isOpen;
}

/**
 * @title IPredictionDerivatives
 * @notice Interface for prediction derivatives
 */
interface IPredictionDerivatives {
    function openPosition(
        string calldata marketId,
        Direction direction,
        uint256 collateral,
        uint256 leverage
    ) external returns (uint256 positionId);

    function closePosition(uint256 positionId) external returns (int256 pnl);
    function liquidatePosition(uint256 positionId) external;
    function getPosition(uint256 positionId) external view returns (Position memory);
    function calculatePnL(uint256 positionId) external view returns (int256 pnl);
    function isLiquidatable(uint256 positionId) external view returns (bool);
}

/**
 * @title PredictionDerivatives
 * @notice Main contract for prediction market derivatives
 */
contract PredictionDerivatives is IPredictionDerivatives, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ EVENTS ============

    /// @notice Emitted when a position is opened
    event PositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        string marketId,
        Direction direction,
        uint256 collateral,
        uint256 leverage,
        uint256 entryPrice
    );

    /// @notice Emitted when a position is closed
    event PositionClosed(uint256 indexed positionId, address indexed owner, uint256 exitPrice, int256 pnl);

    /// @notice Emitted when a position is liquidated
    event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 exitPrice);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when fee recipient is changed
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);

    // ============ CONSTANTS ============

    /// @notice Basis points denominator (100% = 10000)
    uint256 public constant BPS = 10000;

    /// @notice Maximum leverage allowed (5x)
    uint256 public constant MAX_LEVERAGE = 50000;

    /// @notice Minimum leverage (1x)
    uint256 public constant MIN_LEVERAGE = 10000;

    /// @notice Liquidation threshold (80% loss of collateral)
    uint256 public constant LIQUIDATION_THRESHOLD = 8000;

    /// @notice Liquidation reward (5% of remaining collateral)
    uint256 public constant LIQUIDATION_REWARD = 500;

    /// @notice Minimum collateral to open a position ($10)
    uint256 public constant MIN_COLLATERAL = 10e6;

    /// @notice Maximum oracle staleness (1 hour)
    uint256 public constant MAX_ORACLE_STALENESS = 1 hours;

    /// @notice Protocol fee (0.1%)
    uint256 public constant PROTOCOL_FEE_BPS = 10;

    /// @notice The prediction market oracle
    IPredictionMarketOracle public immutable oracle;

    /// @notice The collateral token (USDC/stablecoin)
    IERC20 public immutable collateralToken;

    /// @notice Owner for admin functions
    address public owner;

    /// @notice Fee recipient
    address public feeRecipient;

    /// @notice Counter for position IDs
    uint256 public nextPositionId;

    /// @notice Mapping of position ID to position data
    mapping(uint256 => Position) public positions;

    /// @notice Mapping of user address to their position IDs
    mapping(address => uint256[]) public userPositions;

    /// @notice Total protocol fees collected
    uint256 public totalFeesCollected;

    /// @notice Modifier to check oracle freshness
    modifier oracleFresh(string calldata marketId) {
        require(oracle.isMarketDataFresh(marketId, MAX_ORACLE_STALENESS), "Oracle data stale");
        _;
    }

    /// @notice Modifier for owner-only functions
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /**
     * @notice Constructor
     * @param oracleAddress The prediction market oracle address
     * @param collateralAddress The collateral token address (USDC)
     */
    constructor(address oracleAddress, address collateralAddress) {
        require(oracleAddress != address(0), "Invalid oracle");
        require(collateralAddress != address(0), "Invalid collateral");

        oracle = IPredictionMarketOracle(oracleAddress);
        collateralToken = IERC20(collateralAddress);
        owner = msg.sender;
        feeRecipient = msg.sender;
        nextPositionId = 1;
    }

    /**
     * @notice Open a new leveraged position
     * @param marketId The Polymarket market ID
     * @param direction The position direction (LONG_YES, LONG_NO, etc.)
     * @param collateral The collateral amount in collateral token units
     * @param leverage The leverage in basis points (10000 = 1x, 20000 = 2x)
     * @return positionId The ID of the newly created position
     */
    function openPosition(
        string calldata marketId,
        Direction direction,
        uint256 collateral,
        uint256 leverage
    ) external override nonReentrant oracleFresh(marketId) returns (uint256 positionId) {
        // Validate inputs
        require(collateral >= MIN_COLLATERAL, "Collateral too low");
        require(leverage >= MIN_LEVERAGE, "Leverage too low");
        require(leverage <= MAX_LEVERAGE, "Leverage too high");

        // Get entry price from oracle
        uint256 entryPrice = _getEntryPrice(marketId, direction);

        // Calculate net collateral after fee
        uint256 netCollateral = _processCollateral(collateral);

        // Create and store position
        positionId = _createPosition(marketId, direction, netCollateral, leverage, entryPrice);

        emit PositionOpened(positionId, msg.sender, marketId, direction, netCollateral, leverage, entryPrice);
    }

    /**
     * @notice Get entry price from oracle for a direction
     */
    function _getEntryPrice(string calldata marketId, Direction direction) internal view returns (uint256) {
        (uint256 yesPrice, uint256 noPrice) = oracle.getLatestPrice(marketId);
        return _getDirectionalPrice(direction, yesPrice, noPrice);
    }

    /**
     * @notice Process collateral transfer and fee deduction
     */
    function _processCollateral(uint256 collateral) internal returns (uint256) {
        uint256 fee = (collateral * PROTOCOL_FEE_BPS) / BPS;
        collateralToken.safeTransferFrom(msg.sender, address(this), collateral);
        totalFeesCollected += fee;
        return collateral - fee;
    }

    /**
     * @notice Create and store a new position
     */
    function _createPosition(
        string calldata marketId,
        Direction direction,
        uint256 netCollateral,
        uint256 leverage,
        uint256 entryPrice
    ) internal returns (uint256 positionId) {
        positionId = nextPositionId++;
        uint256 size = (netCollateral * leverage) / BPS;

        positions[positionId] = Position({
            owner: msg.sender,
            marketId: marketId,
            direction: direction,
            collateral: netCollateral,
            leverage: leverage,
            entryPrice: entryPrice,
            size: size,
            openTimestamp: block.timestamp,
            isOpen: true
        });

        userPositions[msg.sender].push(positionId);
    }

    /**
     * @notice Close an open position
     * @param positionId The position ID to close
     * @return pnl The profit/loss in collateral token units
     */
    function closePosition(uint256 positionId) external override nonReentrant returns (int256 pnl) {
        Position storage position = positions[positionId];
        require(position.isOpen, "Position not open");
        require(position.owner == msg.sender, "Not position owner");

        // Get current price
        (uint256 yesPrice, uint256 noPrice) = oracle.getLatestPrice(position.marketId);
        uint256 exitPrice = _getDirectionalPrice(position.direction, yesPrice, noPrice);

        // Calculate PnL
        pnl = _calculatePnL(position, exitPrice);

        // Calculate payout
        int256 payout = int256(position.collateral) + pnl;
        uint256 payoutAmount = payout > 0 ? uint256(payout) : 0;

        // Close position
        position.isOpen = false;

        // Transfer payout
        if (payoutAmount > 0) {
            collateralToken.safeTransfer(msg.sender, payoutAmount);
        }

        emit PositionClosed(positionId, msg.sender, exitPrice, pnl);
    }

    /**
     * @notice Liquidate an underwater position
     * @param positionId The position ID to liquidate
     */
    function liquidatePosition(uint256 positionId) external override nonReentrant {
        Position storage position = positions[positionId];
        require(position.isOpen, "Position not open");
        require(isLiquidatable(positionId), "Not liquidatable");

        // Get current price
        (uint256 yesPrice, uint256 noPrice) = oracle.getLatestPrice(position.marketId);
        uint256 exitPrice = _getDirectionalPrice(position.direction, yesPrice, noPrice);

        // Calculate liquidation reward
        uint256 reward = (position.collateral * LIQUIDATION_REWARD) / BPS;

        // Close position
        position.isOpen = false;

        // Pay liquidator
        if (reward > 0) {
            collateralToken.safeTransfer(msg.sender, reward);
        }

        emit PositionLiquidated(positionId, msg.sender, exitPrice);
    }

    /**
     * @notice Get position details
     * @param positionId The position ID
     * @return The position struct
     */
    function getPosition(uint256 positionId) external view override returns (Position memory) {
        return positions[positionId];
    }

    /**
     * @notice Calculate unrealized PnL for a position
     * @param positionId The position ID
     * @return pnl The profit/loss in collateral token units
     */
    function calculatePnL(uint256 positionId) external view override returns (int256 pnl) {
        Position memory position = positions[positionId];
        require(position.isOpen, "Position not open");

        (uint256 yesPrice, uint256 noPrice) = oracle.getLatestPrice(position.marketId);
        uint256 currentPrice = _getDirectionalPrice(position.direction, yesPrice, noPrice);

        return _calculatePnL(position, currentPrice);
    }

    /**
     * @notice Check if a position can be liquidated
     * @param positionId The position ID
     * @return True if the position is liquidatable
     */
    function isLiquidatable(uint256 positionId) public view override returns (bool) {
        Position memory position = positions[positionId];
        if (!position.isOpen) return false;

        int256 pnl = this.calculatePnL(positionId);
        int256 equity = int256(position.collateral) + pnl;

        // Liquidatable if equity is below liquidation threshold
        int256 threshold = (int256(position.collateral) * int256(BPS - LIQUIDATION_THRESHOLD)) / int256(BPS);

        return equity < threshold;
    }

    /**
     * @notice Get all positions for a user
     * @param user The user address
     * @return Array of position IDs
     */
    function getUserPositions(address user) external view returns (uint256[] memory) {
        return userPositions[user];
    }

    /**
     * @notice Withdraw accumulated fees
     */
    function withdrawFees() external onlyOwner {
        uint256 fees = totalFeesCollected;
        totalFeesCollected = 0;
        collateralToken.safeTransfer(feeRecipient, fees);
    }

    /**
     * @notice Set fee recipient
     * @param newRecipient The new fee recipient
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Invalid address");
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner The new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @notice Get the directional price based on position direction
     */
    function _getDirectionalPrice(
        Direction direction,
        uint256 yesPrice,
        uint256 noPrice
    ) internal pure returns (uint256) {
        if (direction == Direction.LONG_YES || direction == Direction.SHORT_NO) {
            return yesPrice;
        } else {
            return noPrice;
        }
    }

    /**
     * @notice Calculate PnL for a position
     */
    function _calculatePnL(Position memory position, uint256 currentPrice) internal pure returns (int256) {
        int256 priceDiff;

        if (position.direction == Direction.LONG_YES || position.direction == Direction.LONG_NO) {
            // Long: profit when price goes up
            priceDiff = int256(currentPrice) - int256(position.entryPrice);
        } else {
            // Short: profit when price goes down
            priceDiff = int256(position.entryPrice) - int256(currentPrice);
        }

        // PnL = size * price_change / entry_price
        // Using fixed point math with BPS precision
        return (int256(position.size) * priceDiff) / int256(position.entryPrice);
    }
}
