import { useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import { config, coston2, CONTRACTS, DERIVATIVES_ABI, ERC20_ABI, ORACLE_ABI } from './wagmi'

const GAMMA_API = '/api/polymarket'

function App() {
  const { address, isConnected, chain } = useAccount()
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect()
  const publicClient = usePublicClient()

  // Log connect errors (user rejections are normal, don't alert)
  useEffect(() => {
    if (connectError && !connectError.message?.includes('rejected')) {
      console.error('Wallet connect error:', connectError)
    }
  }, [connectError])
  const { disconnect } = useDisconnect()
  const { switchChain } = useSwitchChain()

  const [markets, setMarkets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedMarket, setSelectedMarket] = useState(null)
  const [activeTab, setActiveTab] = useState('trending')
  const [searchQuery, setSearchQuery] = useState('')

  // Positions state
  const [userPositions, setUserPositions] = useState([])
  const [positionsLoading, setPositionsLoading] = useState(false)
  const [closingPositionId, setClosingPositionId] = useState(null)
  const [positionsInitialLoad, setPositionsInitialLoad] = useState(true)

  // Trade state
  const [direction, setDirection] = useState(0) // 0=LONG_YES, 1=LONG_NO, 2=SHORT_YES, 3=SHORT_NO
  const [collateral, setCollateral] = useState(100)
  const [leverage, setLeverage] = useState(2)
  const [txStep, setTxStep] = useState(null)
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Lock body scroll and add class when modal is open
  useEffect(() => {
    if (showHowItWorks || selectedMarket) {
      document.body.style.overflow = 'hidden'
      document.body.classList.add('modal-open')
    } else {
      document.body.style.overflow = ''
      document.body.classList.remove('modal-open')
    }
    return () => { 
      document.body.style.overflow = ''
      document.body.classList.remove('modal-open')
    }
  }, [showHowItWorks, selectedMarket])

  // Contract writes
  const { writeContract: approve, data: approveHash, isPending: isApproving, error: approveError } = useWriteContract()
  const { writeContract: openPosition, data: positionHash, isPending: isOpening, error: positionError } = useWriteContract()
  const { writeContract: mintUsdc, data: mintHash, isPending: isMinting, error: mintError } = useWriteContract()
  const { writeContract: closePosition, data: closeHash, isPending: isClosing, error: closeError } = useWriteContract()

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess, isError: isApproveError } = useWaitForTransactionReceipt({ hash: approveHash })
  const { isLoading: isPositionConfirming, isSuccess: isPositionSuccess, isError: isPositionError } = useWaitForTransactionReceipt({ hash: positionHash })
  const { isLoading: isMintConfirming, isSuccess: isMintSuccess } = useWaitForTransactionReceipt({ hash: mintHash })
  const { isLoading: isCloseConfirming, isSuccess: isCloseSuccess } = useWaitForTransactionReceipt({ hash: closeHash })

  // Read USDC balance
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    enabled: !!address,
  })

  // Read USDC allowance
  const { data: allowance } = useReadContract({
    address: CONTRACTS.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.derivatives] : undefined,
    enabled: !!address,
  })

  // Refetch balance after mint
  useEffect(() => {
    if (isMintSuccess) {
      refetchBalance()
    }
  }, [isMintSuccess, refetchBalance])

  // Calculate P&L client-side using Polymarket prices
  const calculateLivePnL = (position, currentYesPrice, currentNoPrice) => {
    const direction = Number(position.direction)
    const entryPrice = Number(position.entryPrice)
    const size = Number(position.size)

    if (entryPrice === 0) return 0n

    // Direction: 0=LONG_YES, 1=LONG_NO, 2=SHORT_YES, 3=SHORT_NO
    // LONG_YES and SHORT_NO use yesPrice, others use noPrice
    const usesYesPrice = (direction === 0 || direction === 3)
    const currentPrice = usesYesPrice ? currentYesPrice : currentNoPrice

    let priceDiff
    if (direction === 0 || direction === 1) {
      // LONG: profit when price goes up
      priceDiff = currentPrice - entryPrice
    } else {
      // SHORT: profit when price goes down
      priceDiff = entryPrice - currentPrice
    }

    // PnL = size * priceDiff / entryPrice (result in USDC units with 6 decimals)
    const pnl = (size * priceDiff) / entryPrice
    return BigInt(Math.floor(pnl))
  }

  // Fetch user positions (with optional silent mode for auto-refresh)
  const fetchUserPositions = useCallback(async (silent = false) => {
    if (!address || !publicClient) return
    if (!silent) setPositionsLoading(true)
    try {
      // Get position IDs
      const positionIds = await publicClient.readContract({
        address: CONTRACTS.derivatives,
        abi: DERIVATIVES_ABI,
        functionName: 'getUserPositions',
        args: [address],
      })

      // Fetch details for each position
      const positionsData = await Promise.all(
        positionIds.map(async (id) => {
          const position = await publicClient.readContract({
            address: CONTRACTS.derivatives,
            abi: DERIVATIVES_ABI,
            functionName: 'getPosition',
            args: [id],
          })
          return { id, ...position }
        })
      )

      const openPositions = positionsData.filter(p => p.isOpen)

      // Get unique market IDs
      const marketIds = [...new Set(openPositions.map(p => p.marketId))]

      // Fetch live prices from Polymarket API
      const priceMap = {}
      await Promise.all(
        marketIds.map(async (marketId) => {
          try {
            const res = await fetch(`${GAMMA_API}/markets?slug=${marketId}`)
            if (res.ok) {
              const data = await res.json()
              if (data && data[0] && data[0].outcomePrices) {
                const prices = JSON.parse(data[0].outcomePrices)
                // Convert to basis points (0-10000)
                priceMap[marketId] = {
                  yesPrice: Math.round(parseFloat(prices[0]) * 10000),
                  noPrice: Math.round(parseFloat(prices[1]) * 10000),
                }
              }
            }
          } catch (e) {
            console.log('Price fetch error for', marketId, e)
          }
        })
      )

      // Calculate live P&L for each position
      const positionsWithPnL = openPositions.map(position => {
        const prices = priceMap[position.marketId]
        let pnl = 0n
        if (prices) {
          pnl = calculateLivePnL(position, prices.yesPrice, prices.noPrice)
        }
        return { ...position, pnl, livePrices: prices }
      })

      setUserPositions(positionsWithPnL)
      if (positionsInitialLoad) setPositionsInitialLoad(false)
    } catch (err) {
      console.error('Error fetching positions:', err)
    } finally {
      if (!silent) setPositionsLoading(false)
    }
  }, [address, publicClient, positionsInitialLoad])

  // Fetch positions when tab changes or after position opened/closed
  useEffect(() => {
    if (activeTab === 'positions' && isConnected) {
      fetchUserPositions(false) // Show loading on initial load
    } else if (activeTab !== 'positions') {
      setPositionsInitialLoad(true) // Reset for next time user visits
    }
  }, [activeTab, isConnected, fetchUserPositions])

  // Auto-refresh positions every 10 seconds when viewing positions tab (silent)
  useEffect(() => {
    if (activeTab !== 'positions' || !isConnected) return

    const interval = setInterval(() => {
      fetchUserPositions(true) // Silent refresh - no loading state
    }, 10000) // Refresh every 10 seconds

    return () => clearInterval(interval)
  }, [activeTab, isConnected, fetchUserPositions])

  // Refetch positions after opening or closing
  useEffect(() => {
    if (isPositionSuccess || isCloseSuccess) {
      fetchUserPositions()
      refetchBalance()
    }
  }, [isPositionSuccess, isCloseSuccess, fetchUserPositions, refetchBalance])

  const handleClosePosition = (positionId) => {
    setClosingPositionId(positionId)
    closePosition({
      address: CONTRACTS.derivatives,
      abi: DERIVATIVES_ABI,
      functionName: 'closePosition',
      args: [positionId],
    })
  }

  const handleMintUsdc = () => {
    if (!isConnected) {
      handleConnect()
      return
    }
    if (chain?.id !== coston2.id) {
      switchChain({ chainId: coston2.id })
      return
    }
    mintUsdc({
      address: CONTRACTS.usdc,
      abi: ERC20_ABI,
      functionName: 'mint',
      args: [address, parseUnits('1000', 6)], // Mint 1000 USDC
    })
  }

  const fetchMarkets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = `${GAMMA_API}/markets?limit=20&active=true&closed=false`
      if (activeTab === 'trending') url += '&order=volume24hr&ascending=false'
      else if (activeTab === 'new') url += '&order=createdAt&ascending=false'
      else if (activeTab === 'closing') url += '&order=endDate&ascending=true'

      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      setMarkets(data.filter(m => m.outcomePrices && m.question).map(m => {
        const prices = JSON.parse(m.outcomePrices || '["0","0"]')
        return {
          id: m.id,
          slug: m.slug,
          question: m.question,
          image: m.image,
          yesPrice: parseFloat(prices[0]) * 100,
          noPrice: parseFloat(prices[1]) * 100,
          volume24h: m.volume24hr || 0,
          liquidity: m.liquidityNum || 0,
          endDate: m.endDate,
        }
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    fetchMarkets()
  }, [fetchMarkets])

  useEffect(() => {
    if (isApproveSuccess && txStep === 'approve') {
      setTxStep('position')
      executeOpenPosition()
    }
  }, [isApproveSuccess])

  useEffect(() => {
    if (isPositionSuccess) {
      setTxStep('success')
      setTimeout(() => {
        setSelectedMarket(null)
        setTxStep(null)
      }, 3000)
    }
  }, [isPositionSuccess])

  // Handle errors - reset txStep on failure
  useEffect(() => {
    if (approveError || isApproveError) {
      console.error('Approve error:', approveError)
      setTxStep('error')
      setTimeout(() => setTxStep(null), 3000)
    }
  }, [approveError, isApproveError])

  useEffect(() => {
    if (positionError || isPositionError) {
      console.error('Position error:', positionError)
      setTxStep('error')
      setTimeout(() => setTxStep(null), 3000)
    }
  }, [positionError, isPositionError])

  const handleConnect = () => {
    if (!window.ethereum) {
      window.open('https://metamask.io/download/', '_blank')
      return
    }
    const connector = connectors[0]
    if (connector) connect({ connector })
  }

  const executeOpenPosition = () => {
    if (!selectedMarket) return
    const collateralWei = parseUnits(collateral.toString(), 6)
    const leverageBps = BigInt(Math.floor(leverage * 10000))
    
    openPosition({
      address: CONTRACTS.derivatives,
      abi: DERIVATIVES_ABI,
      functionName: 'openPosition',
      args: [selectedMarket.slug, direction, collateralWei, leverageBps],
    })
  }

  const handleOpenPosition = async () => {
    if (!isConnected) {
      handleConnect()
      return
    }

    if (chain?.id !== coston2.id) {
      switchChain({ chainId: coston2.id })
      return
    }

    const collateralWei = parseUnits(collateral.toString(), 6)
    
    // Check if approval needed
    if (!allowance || allowance < collateralWei) {
      setTxStep('approve')
      approve({
        address: CONTRACTS.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.derivatives, parseUnits('1000000', 6)],
      })
    } else {
      setTxStep('position')
      executeOpenPosition()
    }
  }

  const formatVolume = (vol) => {
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(0)}K`
    return `$${vol.toFixed(0)}`
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const diff = Math.floor((d - new Date()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return 'Ended'
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    if (diff < 7) return `${diff}d`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getEntryPrice = () => {
    if (!selectedMarket) return 0
    return (direction === 0 || direction === 3) ? selectedMarket.yesPrice : selectedMarket.noPrice
  }

  const directionLabels = ['LONG YES', 'LONG NO', 'SHORT YES', 'SHORT NO']
  const directionDescs = ['Profit if YES ↑', 'Profit if NO ↑', 'Profit if YES ↓', 'Profit if NO ↓']

  const filteredMarkets = markets.filter(m => m.question.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <img src="/logo.png" alt="POLYFLUX" className="logo-image" />
        </div>

        <div className="search-container">
          <input
            type="text"
            placeholder="Search prediction markets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="header-actions">
          <button className="how-it-works-btn" onClick={() => setShowHowItWorks(true)}>
            How It Works
          </button>
          {isConnected && (
            <div className="usdc-balance">
              <span>{usdcBalance ? formatUnits(usdcBalance, 6) : '0'} USDC</span>
              <button
                className="faucet-btn"
                onClick={handleMintUsdc}
                disabled={isMinting || isMintConfirming}
              >
                {isMinting || isMintConfirming ? '...' : '+'}
              </button>
            </div>
          )}
          <div className="network-badge">
            <span className="pulse"></span>
            {chain?.name || 'Coston2'}
          </div>
          <button className="connect-btn" onClick={isConnected ? disconnect : handleConnect} disabled={isConnecting}>
            {isConnecting ? 'Connecting...' : isConnected ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect'}
          </button>
        </div>
      </header>

      <main className="main">
        <div className="hero">
          <h1>Leveraged Prediction Markets</h1>
          <p>Long, short, and leverage positions on real-world events. Powered by Flare FDC.</p>
        </div>

        <div className="tabs">
          {['trending', 'new', 'closing', 'positions'].map(tab => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? 'active' : ''} ${tab === 'positions' ? 'positions-tab' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'positions' ? 'My Positions' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'positions' ? (
          // My Positions View
          !isConnected ? (
            <div className="positions-empty">
              <h3>Connect Your Wallet</h3>
              <p>Connect your wallet to view your positions</p>
              <button className="connect-btn" onClick={handleConnect}>Connect Wallet</button>
            </div>
          ) : positionsLoading ? (
            <div className="loading"><div className="spinner" />Loading positions...</div>
          ) : userPositions.length === 0 ? (
            <div className="positions-empty">
              <h3>No Open Positions</h3>
              <p>You don't have any open positions yet. Browse markets and open your first position!</p>
              <button className="tab" onClick={() => setActiveTab('trending')}>Browse Markets</button>
            </div>
          ) : (
            <div className="positions-list">
              {userPositions.map((position, i) => {
                const dirLabels = ['LONG YES', 'LONG NO', 'SHORT YES', 'SHORT NO']
                const pnlValue = Number(formatUnits(position.pnl, 6))
                const collateralValue = Number(formatUnits(position.collateral, 6))
                const leverageValue = Number(position.leverage) / 10000
                const entryPriceValue = Number(position.entryPrice) / 100
                const pnlPercent = collateralValue > 0 ? (pnlValue / collateralValue) * 100 : 0
                const isClosingThis = closingPositionId === position.id && (isClosing || isCloseConfirming)

                // Get current price based on direction (LONG_YES/SHORT_NO use yesPrice, others use noPrice)
                const direction = Number(position.direction)
                const usesYesPrice = (direction === 0 || direction === 3)
                const currentPriceValue = position.livePrices
                  ? (usesYesPrice ? position.livePrices.yesPrice : position.livePrices.noPrice) / 100
                  : null

                return (
                  <motion.div
                    key={position.id.toString()}
                    className="position-card"
                    initial={positionsInitialLoad ? { opacity: 0, y: 20 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={positionsInitialLoad ? { delay: i * 0.05 } : { duration: 0 }}
                  >
                    <div className="position-header">
                      <span className={`position-direction ${position.direction < 2 ? 'long' : 'short'}`}>
                        {dirLabels[position.direction]}
                      </span>
                      <span className="position-leverage">{leverageValue}x</span>
                    </div>

                    <div className="position-market">
                      {position.marketId}
                    </div>

                    <div className="position-stats">
                      <div className="stat">
                        <span className="stat-label">Collateral</span>
                        <span className="stat-value">${collateralValue.toFixed(2)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Size</span>
                        <span className="stat-value">${(collateralValue * leverageValue).toFixed(2)}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Entry</span>
                        <span className="stat-value">{entryPriceValue.toFixed(1)}¢</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Current <span className="live-badge">LIVE</span></span>
                        <span className="stat-value">{currentPriceValue !== null ? `${currentPriceValue.toFixed(1)}¢` : '...'}</span>
                      </div>
                      <div className="stat pnl-stat">
                        <span className="stat-label">P&L <span className="live-badge">LIVE</span></span>
                        <span className={`stat-value ${pnlValue >= 0 ? 'profit' : 'loss'}`}>
                          {pnlValue >= 0 ? '+' : ''}{pnlValue.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%)
                        </span>
                      </div>
                    </div>

                    <button
                      className="close-position-btn"
                      onClick={() => handleClosePosition(position.id)}
                      disabled={isClosingThis}
                    >
                      {isClosingThis ? 'Closing...' : 'Close Position'}
                    </button>
                  </motion.div>
                )
              })}
            </div>
          )
        ) : loading ? (
          <div className="loading"><div className="spinner" />Loading markets...</div>
        ) : error ? (
          <div className="error">{error} <button onClick={fetchMarkets}>Retry</button></div>
        ) : (
          <div className="markets-grid">
            {filteredMarkets.map((market, i) => (
              <motion.div
                key={market.id}
                className="market-card"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => { setSelectedMarket(market); setDirection(0); setTxStep(null) }}
              >
                {market.image && <img src={market.image} alt="" className="market-img" onError={e => e.target.style.display = 'none'} />}
                <div className="market-meta">
                  <span>{formatVolume(market.volume24h)}</span>
                  {market.endDate && <span>{formatDate(market.endDate)}</span>}
                </div>
                <h3 className="market-question">{market.question}</h3>
                <div className="market-odds">
                  <div className="odd yes">
                    <span>YES</span>
                    <strong>{market.yesPrice.toFixed(0)}¢</strong>
                  </div>
                  <div className="odd no">
                    <span>NO</span>
                    <strong>{market.noPrice.toFixed(0)}¢</strong>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      <AnimatePresence>
        {selectedMarket && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMarket(null)}
          >
            <motion.div
              className="modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setSelectedMarket(null)}>×</button>
              
              <h2>{selectedMarket.question}</h2>
              
              <div className="modal-stats">
                <div><label>Volume</label><span>{formatVolume(selectedMarket.volume24h)}</span></div>
                <div><label>Liquidity</label><span>{formatVolume(selectedMarket.liquidity)}</span></div>
              </div>

              <div className="prices-row">
                <div className="price-card yes">
                  <span>YES</span>
                  <strong>{selectedMarket.yesPrice.toFixed(1)}¢</strong>
                </div>
                <div className="price-card no">
                  <span>NO</span>
                  <strong>{selectedMarket.noPrice.toFixed(1)}¢</strong>
                </div>
              </div>

              <div className="form-section">
                <label>Direction</label>
                <div className="direction-grid">
                  {[0, 1, 2, 3].map(d => (
                    <button
                      key={d}
                      className={`direction-btn ${d < 2 ? 'long' : 'short'} ${direction === d ? 'active' : ''}`}
                      onClick={() => setDirection(d)}
                    >
                      <span className="name">{directionLabels[d]}</span>
                      <span className="desc">{directionDescs[d]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-section">
                <label>Collateral (USDC)</label>
                <input
                  type="number"
                  value={collateral}
                  onChange={e => setCollateral(Number(e.target.value))}
                  min={10}
                  className="input"
                />
              </div>

              <div className="form-section">
                <label>Leverage: <span className="highlight">{leverage}x</span></label>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.5}
                  value={leverage}
                  onChange={e => setLeverage(Number(e.target.value))}
                  className="slider"
                />
                <div className="slider-labels">
                  <span>1x</span><span>2x</span><span>3x</span><span>4x</span><span>5x</span>
                </div>
              </div>

              <div className="summary">
                <div><span>Position Size</span><strong>${(collateral * leverage).toLocaleString()}</strong></div>
                <div><span>Entry Price</span><strong>{getEntryPrice().toFixed(1)}¢</strong></div>
                <div><span>Liquidation</span><strong className="warn">{(getEntryPrice() * 0.2).toFixed(1)}¢</strong></div>
              </div>

              {txStep && (
                <div className={`tx-status ${txStep === 'success' ? 'success' : ''} ${txStep === 'error' ? 'error' : ''}`}>
                  {txStep === 'approve' && (isApproving || isApproveConfirming) && 'Approving USDC...'}
                  {txStep === 'approve' && !isApproving && !isApproveConfirming && !approveError && 'Confirm in wallet...'}
                  {txStep === 'position' && (isOpening || isPositionConfirming) && 'Opening position...'}
                  {txStep === 'position' && !isOpening && !isPositionConfirming && !positionError && 'Confirm in wallet...'}
                  {txStep === 'success' && 'Position opened successfully'}
                  {txStep === 'error' && 'Transaction failed — oracle may not have data for this market'}
                </div>
              )}

              {usdcBalance !== undefined && usdcBalance < parseUnits(collateral.toString(), 6) && (
                <div className="tx-status error">
                  Insufficient USDC balance. Click + in header to get testnet USDC.
                </div>
              )}

              <button
                className={`submit-btn ${direction < 2 ? 'long' : 'short'}`}
                onClick={handleOpenPosition}
                disabled={isApproving || isOpening || isApproveConfirming || isPositionConfirming}
              >
                {!isConnected ? 'Connect Wallet' : 
                 chain?.id !== coston2.id ? 'Switch to Coston2' :
                 (isApproving || isOpening || isApproveConfirming || isPositionConfirming) ? 'Processing...' :
                 `Open ${leverage}x ${directionLabels[direction]}`}
              </button>

              <p className="footnote">Prices via Flare Data Connector from Polymarket</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* How It Works Modal */}
      <AnimatePresence>
        {showHowItWorks && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowHowItWorks(false)}
          >
            <motion.div
              className="modal how-it-works-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setShowHowItWorks(false)}>×</button>
              
              <h2>How POLYFLUX Works</h2>
              
              <div className="how-section">
                <div className="how-number">1</div>
                <div className="how-content">
                  <h3>Real-World Data via Flare FDC</h3>
                  <p>
                    POLYFLUX uses <strong>Flare's Data Connector (FDC)</strong> with the <strong>Web2Json</strong> 
                    attestation type to bring Polymarket prices on-chain. The FDC cryptographically verifies 
                    data from Polymarket's API, ensuring trustless and tamper-proof price feeds.
                  </p>
                </div>
              </div>

              <div className="how-section">
                <div className="how-number">2</div>
                <div className="how-content">
                  <h3>Understanding Positions</h3>
                  <p>Unlike Polymarket where you simply buy YES or NO shares, POLYFLUX offers four position types:</p>
                  
                  <div className="positions-explainer">
                    <div className="position-type long">
                      <h4>LONG YES</h4>
                      <p>Profit when YES price <strong>increases</strong>. Like buying YES shares on Polymarket, but with leverage.</p>
                      <span className="example">YES at 40¢ → 60¢ = profit</span>
                    </div>
                    
                    <div className="position-type long">
                      <h4>LONG NO</h4>
                      <p>Profit when NO price <strong>increases</strong>. Equivalent to buying NO shares with leverage.</p>
                      <span className="example">NO at 60¢ → 80¢ = profit</span>
                    </div>
                    
                    <div className="position-type short">
                      <h4>SHORT YES</h4>
                      <p>Profit when YES price <strong>decreases</strong>. Bet against a YES outcome without holding shares.</p>
                      <span className="example">YES at 60¢ → 40¢ = profit</span>
                    </div>
                    
                    <div className="position-type short">
                      <h4>SHORT NO</h4>
                      <p>Profit when NO price <strong>decreases</strong>. Bet against the NO outcome.</p>
                      <span className="example">NO at 70¢ → 50¢ = profit</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="how-section">
                <div className="how-number">3</div>
                <div className="how-content">
                  <h3>Leverage & Liquidation</h3>
                  <p>
                    Leverage amplifies both gains and losses. At <strong>2x leverage</strong>, a 10% price move 
                    becomes a 20% P&L. Positions are liquidated when losses approach your collateral 
                    (approximately 80% loss on the leveraged position).
                  </p>
                  <div className="leverage-example">
                    <div className="lev-row">
                      <span>$100 collateral @ 2x</span>
                      <span>=</span>
                      <span>$200 position size</span>
                    </div>
                    <div className="lev-row highlight">
                      <span>YES moves 40¢ → 50¢ (+25%)</span>
                      <span>=</span>
                      <span>+$50 profit (+50%)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="how-section">
                <div className="how-number">4</div>
                <div className="how-content">
                  <h3>Why Flare?</h3>
                  <p>
                    Flare is the only blockchain with native data connectivity built in. The FDC allows 
                    smart contracts to trustlessly access any Web2 API—in this case, Polymarket's real-time 
                    odds. No centralized oracles, no single points of failure.
                  </p>
                </div>
              </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="footer">
        <span>POLYFLUX • Prediction Derivatives on Flare</span>
      </footer>
    </div>
  )
}

export default App
