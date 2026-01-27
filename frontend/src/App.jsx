import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const GAMMA_API = "https://gamma-api.polymarket.com";

function App() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [activeTab, setActiveTab] = useState("trending");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchMarkets();
  }, [activeTab]);

  const fetchMarkets = async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `${GAMMA_API}/markets?limit=20&active=true&closed=false`;

      if (activeTab === "trending") {
        url += "&order=volume24hr&ascending=false";
      } else if (activeTab === "new") {
        url += "&order=createdAt&ascending=false";
      } else if (activeTab === "closing") {
        url += "&order=endDate&ascending=true";
      }

      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch markets");

      const data = await response.json();

      const formatted = data
        .filter((m) => m.outcomePrices && m.question)
        .map((m) => {
          const prices = JSON.parse(m.outcomePrices || '["0","0"]');
          return {
            id: m.id,
            question: m.question,
            image: m.image,
            yesPrice: parseFloat(prices[0]) * 100,
            noPrice: parseFloat(prices[1]) * 100,
            volume24h: m.volume24hr || 0,
            liquidity: m.liquidityNum || 0,
            endDate: m.endDate,
            category: m.category,
          };
        });

      setMarkets(formatted);
    } catch (err) {
      setError(err.message);
      console.error("Error fetching markets:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMarkets = markets.filter((m) =>
    m.question.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatVolume = (vol) => {
    if (vol >= 1000000) return `$${(vol / 1000000).toFixed(1)}M`;
    if (vol >= 1000) return `$${(vol / 1000).toFixed(0)}K`;
    return `$${vol.toFixed(0)}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return "Ended";
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <svg viewBox="0 0 32 32" className="logo-icon">
              <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16 6 L16 16 L24 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <circle cx="16" cy="16" r="3" fill="currentColor" />
            </svg>
            <span className="logo-text">FLUX</span>
          </div>
        </div>

        <div className="header-center">
          <div className="search-box">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="header-right">
          <div className="fdc-badge">
            <span className="badge-dot" />
            Flare FDC
          </div>
          <button className="connect-btn">Connect Wallet</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Tabs */}
        <div className="tabs-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === "trending" ? "active" : ""}`}
              onClick={() => setActiveTab("trending")}
            >
              🔥 Trending
            </button>
            <button
              className={`tab ${activeTab === "new" ? "active" : ""}`}
              onClick={() => setActiveTab("new")}
            >
              ✨ New
            </button>
            <button
              className={`tab ${activeTab === "closing" ? "active" : ""}`}
              onClick={() => setActiveTab("closing")}
            >
              ⏰ Closing Soon
            </button>
          </div>
        </div>

        {/* Markets Grid */}
        <div className="markets-container">
          {loading ? (
            <div className="loading">
              <div className="spinner" />
              <span>Loading markets...</span>
            </div>
          ) : error ? (
            <div className="error">
              <span>⚠️ {error}</span>
              <button onClick={fetchMarkets}>Retry</button>
            </div>
          ) : (
            <div className="markets-grid">
              {filteredMarkets.map((market, index) => (
                <motion.div
                  key={market.id}
                  className="market-card"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.05 }}
                  onClick={() => setSelectedMarket(market)}
                >
                  <div className="market-header">
                    {market.image && (
                      <img
                        src={market.image}
                        alt=""
                        className="market-image"
                        onError={(e) => (e.target.style.display = "none")}
                      />
                    )}
                    <div className="market-meta">
                      <span className="market-volume">{formatVolume(market.volume24h)} vol</span>
                      {market.endDate && <span className="market-end">{formatDate(market.endDate)}</span>}
                    </div>
                  </div>

                  <h3 className="market-question">{market.question}</h3>

                  <div className="market-prices">
                    <div className="price-row">
                      <div className="price-label">
                        <span className="outcome yes">Yes</span>
                      </div>
                      <div className="price-bar-container">
                        <div className="price-bar yes" style={{ width: `${Math.max(market.yesPrice, 2)}%` }} />
                      </div>
                      <span className="price-value">{market.yesPrice.toFixed(0)}¢</span>
                    </div>
                    <div className="price-row">
                      <div className="price-label">
                        <span className="outcome no">No</span>
                      </div>
                      <div className="price-bar-container">
                        <div className="price-bar no" style={{ width: `${Math.max(market.noPrice, 2)}%` }} />
                      </div>
                      <span className="price-value">{market.noPrice.toFixed(0)}¢</span>
                    </div>
                  </div>

                  <div className="market-actions">
                    <button className="action-btn buy-yes">Buy Yes</button>
                    <button className="action-btn buy-no">Buy No</button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Market Detail Modal */}
      <AnimatePresence>
        {selectedMarket && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMarket(null)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setSelectedMarket(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>

              <div className="modal-content">
                {selectedMarket.image && <img src={selectedMarket.image} alt="" className="modal-image" />}

                <h2 className="modal-question">{selectedMarket.question}</h2>

                <div className="modal-stats">
                  <div className="stat">
                    <span className="stat-label">24h Volume</span>
                    <span className="stat-value">{formatVolume(selectedMarket.volume24h)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Liquidity</span>
                    <span className="stat-value">{formatVolume(selectedMarket.liquidity)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Ends</span>
                    <span className="stat-value">{formatDate(selectedMarket.endDate)}</span>
                  </div>
                </div>

                <div className="modal-prices">
                  <div className="modal-price yes">
                    <span className="label">Yes</span>
                    <span className="value">{selectedMarket.yesPrice.toFixed(1)}¢</span>
                  </div>
                  <div className="modal-price no">
                    <span className="label">No</span>
                    <span className="value">{selectedMarket.noPrice.toFixed(1)}¢</span>
                  </div>
                </div>

                <div className="modal-trade">
                  <div className="trade-input">
                    <label>Amount (USDC)</label>
                    <input type="number" placeholder="100" defaultValue="100" />
                  </div>

                  <div className="trade-buttons">
                    <button className="trade-btn yes">Buy Yes @ {selectedMarket.yesPrice.toFixed(0)}¢</button>
                    <button className="trade-btn no">Buy No @ {selectedMarket.noPrice.toFixed(0)}¢</button>
                  </div>

                  <p className="trade-note">Prices sourced via Flare Data Connector from Polymarket</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <span>Market data via Flare Data Connector</span>
          <span className="separator">•</span>
          <span>Built on Flare Network</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
