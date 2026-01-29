import { expect } from "chai";

const PredictionMarketOracle = artifacts.require("PredictionMarketOracle");

/**
 * PredictionMarketOracle Test Suite (Truffle)
 *
 * Test coverage:
 * - Unit tests for individual functions
 * - Invariant tests for state consistency
 * - Access control tests
 * - Edge case testing
 */

contract("PredictionMarketOracle", function (accounts) {
    const [owner, user] = accounts;
    let oracle: any;

    // Constants matching contract
    const MAX_PRICE_BPS = 10000;
    const MIN_LIQUIDITY = web3.utils.toBN("1000000000"); // $1000 (6 decimals)

    beforeEach(async function () {
        oracle = await PredictionMarketOracle.new({ from: owner });
    });

    describe("Deployment", function () {
        it("should set deployer as owner", async function () {
            expect(await oracle.owner()).to.equal(owner);
        });

        it("should have correct constants", async function () {
            expect((await oracle.MAX_PRICE_BPS()).toNumber()).to.equal(MAX_PRICE_BPS);
            expect((await oracle.MIN_LIQUIDITY()).toString()).to.equal(MIN_LIQUIDITY.toString());
        });

        it("should start with zero markets", async function () {
            expect((await oracle.getMarketCount()).toNumber()).to.equal(0);
        });
    });

    describe("Market Whitelisting", function () {
        const marketId = "test-market";

        it("should allow owner to whitelist a market", async function () {
            const tx = await oracle.whitelistMarket(marketId, { from: owner });
            expect(tx.logs[0].event).to.equal("MarketWhitelisted");
            // Indexed string args are hashed, so we verify the market was actually whitelisted
            expect(await oracle.whitelistedMarkets(marketId)).to.be.true;
        });

        it("should allow owner to delist a market", async function () {
            await oracle.whitelistMarket(marketId, { from: owner });
            const tx = await oracle.delistMarket(marketId, { from: owner });
            expect(tx.logs[0].event).to.equal("MarketDelisted");
            expect(await oracle.whitelistedMarkets(marketId)).to.be.false;
        });

        it("should revert when non-owner tries to whitelist", async function () {
            try {
                await oracle.whitelistMarket(marketId, { from: user });
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Only owner");
            }
        });

        it("should revert when non-owner tries to delist", async function () {
            try {
                await oracle.delistMarket(marketId, { from: user });
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Only owner");
            }
        });
    });

    describe("Ownership", function () {
        it("should allow owner to transfer ownership", async function () {
            await oracle.transferOwnership(user, { from: owner });
            expect(await oracle.owner()).to.equal(user);
        });

        it("should revert when non-owner tries to transfer ownership", async function () {
            try {
                await oracle.transferOwnership(user, { from: user });
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Only owner");
            }
        });

        it("should revert when transferring to zero address", async function () {
            try {
                await oracle.transferOwnership("0x0000000000000000000000000000000000000000", { from: owner });
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Invalid address");
            }
        });
    });

    describe("Market Data Queries", function () {
        it("should revert when querying non-existent market", async function () {
            try {
                await oracle.getMarketData("non-existent");
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Market not found");
            }
        });

        it("should revert when getting price for non-existent market", async function () {
            try {
                await oracle.getLatestPrice("non-existent");
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Market not found");
            }
        });

        it("should return false for freshness check on non-existent market", async function () {
            expect(await oracle.isMarketDataFresh("non-existent", 3600)).to.be.false;
        });
    });

    describe("Edge Cases", function () {
        it("should handle empty market ID string", async function () {
            try {
                await oracle.getMarketData("");
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Market not found");
            }
        });

        it("should handle very long market ID strings", async function () {
            const longId = "a".repeat(1000);
            try {
                await oracle.getMarketData(longId);
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Market not found");
            }
        });

        it("should handle special characters in market ID", async function () {
            const specialId = "test-market-123_special!@#";
            try {
                await oracle.getMarketData(specialId);
                expect.fail("Expected revert");
            } catch (error: any) {
                expect(error.message).to.include("Market not found");
            }
        });
    });

    describe("Gas Usage", function () {
        it("should have reasonable gas for whitelisting", async function () {
            const tx = await oracle.whitelistMarket("test-market", { from: owner });
            // Whitelist should use < 100k gas
            expect(tx.receipt.gasUsed).to.be.lt(100000);
        });

        it("should not revert when querying market count", async function () {
            await oracle.getMarketCount();
        });
    });
});
