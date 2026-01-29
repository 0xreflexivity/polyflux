{
  "attestationType": "0x5765623254736f6e00000000000000000000000000000000000000000000000000",
  "sourceId": "0x5075626c696357656232000000000000000000000000000000000000000000000",
  "requestBody": {
    "url": "https://gamma-api.polymarket.com/markets?slug=will-trump-deport-250000-500000-people",
    "httpMethod": "GET",
    "headers": "{}",
    "queryParams": "{}",
    "body": "{}",
    "postProcessJq": ". | if type == \"array\" then .[0] else . end | { marketId: .slug, question: (.question | if length > 100 then .[:100] else . end), yesPrice: ((.outcomePrices | fromjson)[0] | tonumber * 10000 | floor), noPrice: ((.outcomePrices | fromjson)[1] | tonumber * 10000 | floor), volume: ((.volume24hr // 0) * 1000000 | floor), liquidity: ((.liquidityNum // 0) * 1000000 | floor) }",
    "abiSignature": "{\"components\":[{\"internalType\":\"string\",\"name\":\"marketId\",\"type\":\"string\"},{\"internalType\":\"string\",\"name\":\"question\",\"type\":\"string\"},{\"internalType\":\"uint256\",\"name\":\"yesPrice\",\"type\":\"uint256\"},{\"internalType\":\"uint256\",\"name\":\"noPrice\",\"type\":\"uint256\"},{\"internalType\":\"uint256\",\"name\":\"volume\",\"type\":\"uint256\"},{\"internalType\":\"uint256\",\"name\":\"liquidity\",\"type\":\"uint256\"}],\"name\":\"MarketDTO\",\"type\":\"tuple\"}"
  }
}

