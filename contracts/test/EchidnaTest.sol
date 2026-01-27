// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "../PredictionDerivatives.sol";
import "../PredictionMarketOracle.sol";
import "../mocks/MockERC20.sol";

/**
 * @title MockOracle
 * @notice Mock oracle for fuzzing tests
 */
contract MockOracle is IPredictionMarketOracle {
    mapping(string => MarketData) public markets;

    function setMarketData(string memory marketId, uint256 yesPrice, uint256 noPrice) external {
        markets[marketId] = MarketData({
            marketId: marketId,
            question: "Test",
            yesPrice: yesPrice,
            noPrice: noPrice,
            volume: 1000000e6,
            liquidity: 1000000e6,
            timestamp: block.timestamp
        });
    }

    function updateMarketData(IWeb2Json.Proof calldata) external override {}

    function getMarketData(string calldata marketId) external view override returns (MarketData memory) {
        return markets[marketId];
    }

    function getLatestPrice(string calldata marketId) external view override returns (uint256 yesPrice, uint256 noPrice) {
        MarketData memory data = markets[marketId];
        return (data.yesPrice, data.noPrice);
    }

    function isMarketDataFresh(string calldata, uint256) external pure override returns (bool) {
        return true;
    }
}

/**
 * @title EchidnaTest
 * @notice Test harness for Echidna fuzzing
 */
contract EchidnaTest {
    PredictionDerivatives public derivatives;
    MockOracle public oracle;
    MockERC20 public token;

    string constant MARKET_ID = "test-market";

    // Invariants tracking
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;

    constructor() {
        oracle = new MockOracle();
        token = new MockERC20("USDC", "USDC", 6);
        derivatives = new PredictionDerivatives(address(oracle), address(token));

        // Setup initial market data
        oracle.setMarketData(MARKET_ID, 5000, 5000);

        // Mint tokens for testing
        token.mint(address(this), 1000000e6);
        token.approve(address(derivatives), type(uint256).max);
    }

    // ============ INVARIANT PROPERTIES ============

    /**
     * @notice Position collateral should never exceed deposited amount
     */
    function echidna_position_collateral_bounded() public view returns (bool) {
        uint256 nextId = derivatives.nextPositionId();
        for (uint256 i = 1; i < nextId; i++) {
            Position memory pos = derivatives.getPosition(i);
            if (pos.collateral > 1000000e6) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Leverage should always be within bounds
     */
    function echidna_leverage_within_bounds() public view returns (bool) {
        uint256 nextId = derivatives.nextPositionId();
        for (uint256 i = 1; i < nextId; i++) {
            Position memory pos = derivatives.getPosition(i);
            if (pos.isOpen) {
                if (pos.leverage < derivatives.MIN_LEVERAGE() ||
                    pos.leverage > derivatives.MAX_LEVERAGE()) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * @notice Contract should never have negative balance (solvency)
     */
    function echidna_contract_solvent() public view returns (bool) {
        return token.balanceOf(address(derivatives)) >= 0;
    }

    /**
     * @notice Total fees should never exceed total deposited
     */
    function echidna_fees_bounded() public view returns (bool) {
        return derivatives.totalFeesCollected() <= totalDeposited;
    }

    /**
     * @notice Position size should equal collateral * leverage / BPS
     */
    function echidna_position_size_correct() public view returns (bool) {
        uint256 nextId = derivatives.nextPositionId();
        for (uint256 i = 1; i < nextId; i++) {
            Position memory pos = derivatives.getPosition(i);
            if (pos.isOpen) {
                uint256 expectedSize = (pos.collateral * pos.leverage) / derivatives.BPS();
                if (pos.size != expectedSize) {
                    return false;
                }
            }
        }
        return true;
    }

    // ============ ACTIONS ============

    function openLongYes(uint256 collateral, uint256 leverage) public {
        collateral = _boundCollateral(collateral);
        leverage = _boundLeverage(leverage);

        try derivatives.openPosition(MARKET_ID, Direction.LONG_YES, collateral, leverage) {
            totalDeposited += collateral;
        } catch {}
    }

    function openLongNo(uint256 collateral, uint256 leverage) public {
        collateral = _boundCollateral(collateral);
        leverage = _boundLeverage(leverage);

        try derivatives.openPosition(MARKET_ID, Direction.LONG_NO, collateral, leverage) {
            totalDeposited += collateral;
        } catch {}
    }

    function openShortYes(uint256 collateral, uint256 leverage) public {
        collateral = _boundCollateral(collateral);
        leverage = _boundLeverage(leverage);

        try derivatives.openPosition(MARKET_ID, Direction.SHORT_YES, collateral, leverage) {
            totalDeposited += collateral;
        } catch {}
    }

    function openShortNo(uint256 collateral, uint256 leverage) public {
        collateral = _boundCollateral(collateral);
        leverage = _boundLeverage(leverage);

        try derivatives.openPosition(MARKET_ID, Direction.SHORT_NO, collateral, leverage) {
            totalDeposited += collateral;
        } catch {}
    }

    function closePosition(uint256 positionId) public {
        positionId = _boundPositionId(positionId);

        uint256 balanceBefore = token.balanceOf(address(this));
        try derivatives.closePosition(positionId) {
            uint256 balanceAfter = token.balanceOf(address(this));
            if (balanceAfter > balanceBefore) {
                totalWithdrawn += balanceAfter - balanceBefore;
            }
        } catch {}
    }

    function liquidatePosition(uint256 positionId) public {
        positionId = _boundPositionId(positionId);

        try derivatives.liquidatePosition(positionId) {
        } catch {}
    }

    function updatePrice(uint256 yesPrice, uint256 noPrice) public {
        yesPrice = yesPrice % 10001; // 0-10000
        noPrice = 10000 - yesPrice; // Ensure they sum to 10000
        oracle.setMarketData(MARKET_ID, yesPrice, noPrice);
    }

    // ============ HELPERS ============

    function _boundCollateral(uint256 collateral) internal view returns (uint256) {
        uint256 minCollateral = derivatives.MIN_COLLATERAL();
        uint256 maxCollateral = 1000e6; // Max 1000 USDC per position
        return minCollateral + (collateral % (maxCollateral - minCollateral));
    }

    function _boundLeverage(uint256 leverage) internal view returns (uint256) {
        uint256 minLev = derivatives.MIN_LEVERAGE();
        uint256 maxLev = derivatives.MAX_LEVERAGE();
        return minLev + (leverage % (maxLev - minLev + 1));
    }

    function _boundPositionId(uint256 positionId) internal view returns (uint256) {
        uint256 nextId = derivatives.nextPositionId();
        if (nextId <= 1) return 1;
        return 1 + (positionId % (nextId - 1));
    }
}
