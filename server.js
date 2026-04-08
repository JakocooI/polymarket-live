const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ==================== CONFIG ====================
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const POLYMARKET_WS = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

// ==================== STATE ====================
let marketCache = [];
let priceHistory = {}; // tokenId -> [{price, ts}]
let volumeHistory = {}; // tokenId -> [{volume, ts}]
let signals = [];
let activeClients = new Set();
let polyWs = null;
let subscribedTokens = new Set();

// ==================== BROADCAST ====================
function broadcast(data) {
  const msg = JSON.stringify(data);
  activeClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ==================== POLYMARKET WS ====================
function connectPolymarketWS(tokenIds) {
  if (polyWs) {
    try { polyWs.close(); } catch(e) {}
  }

  polyWs = new WebSocket(POLYMARKET_WS);

  polyWs.on('open', () => {
    console.log('[WS] Connected to Polymarket');
    // Subscribe to price/trade updates
    const msg = {
      type: 'market',
      assets_ids: tokenIds.slice(0, 50) // limit to 50
    };
    polyWs.send(JSON.stringify(msg));
    broadcast({ type: 'ws_status', connected: true });
  });

  polyWs.on('message', (raw) => {
    try {
      const events = JSON.parse(raw);
      const arr = Array.isArray(events) ? events : [events];
      arr.forEach(ev => processWsEvent(ev));
    } catch(e) {}
  });

  polyWs.on('close', () => {
    console.log('[WS] Polymarket WS closed, reconnecting in 5s...');
    broadcast({ type: 'ws_status', connected: false });
    setTimeout(() => {
      if (subscribedTokens.size > 0) {
        connectPolymarketWS([...subscribedTokens]);
      }
    }, 5000);
  });

  polyWs.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
}

function processWsEvent(ev) {
  if (!ev || !ev.asset_id) return;

  const tokenId = ev.asset_id;
  const now = Date.now();

  // Track price
  if (ev.best_ask || ev.best_bid) {
    const price = ev.best_ask ? parseFloat(ev.best_ask) : parseFloat(ev.best_bid);
    if (!priceHistory[tokenId]) priceHistory[tokenId] = [];
    priceHistory[tokenId].push({ price, ts: now });
    // Keep only last 30 min
    priceHistory[tokenId] = priceHistory[tokenId].filter(p => now - p.ts < 30 * 60 * 1000);

    // Check for price jump signal
    checkPriceJump(tokenId, price, now);
  }

  // Track volume
  if (ev.volume) {
    const vol = parseFloat(ev.volume);
    if (!volumeHistory[tokenId]) volumeHistory[tokenId] = [];
    volumeHistory[tokenId].push({ volume: vol, ts: now });
    volumeHistory[tokenId] = volumeHistory[tokenId].filter(v => now - v.ts < 30 * 60 * 1000);
    checkVolumeSpikeSignal(tokenId, vol, now);
  }

  broadcast({ type: 'price_update', tokenId, data: ev });
}

// ==================== SIGNAL ENGINE ====================
function checkPriceJump(tokenId, currentPrice, now) {
  const history = priceHistory[tokenId];
  if (!history || history.length < 2) return;

  const threeMinAgo = history.filter(p => now - p.ts <= 3 * 60 * 1000);
  if (!threeMinAgo.length) return;

  const oldPrice = threeMinAgo[0].price;
  if (oldPrice === 0) return;
  const pctChange = Math.abs((currentPrice - oldPrice) / oldPrice) * 100;

  if (pctChange >= 8) {
    const market = marketCache.find(m =>
      m.tokens && m.tokens.some(t => t.token_id === tokenId)
    );
    if (!market) return;

    const liquidity = parseFloat(market.liquidity || 0);
    if (liquidity < 10000) return;

    const signal = {
      id: `pj_${tokenId}_${now}`,
      type: 'PRICE_JUMP',
      tokenId,
      marketId: market.id,
      marketTitle: market.question,
      change: pctChange.toFixed(2),
      direction: currentPrice > oldPrice ? 'UP' : 'DOWN',
      price: currentPrice,
      strength: pctChange >= 15 ? 3 : pctChange >= 12 ? 2 : 1,
      ts: now
    };
    addSignal(signal);
  }
}

function checkVolumeSpikeSignal(tokenId, currentVolume, now) {
  const history = volumeHistory[tokenId];
  if (!history || history.length < 3) return;

  const fifteenMinAgo = history.filter(v => now - v.ts <= 15 * 60 * 1000);
  if (fifteenMinAgo.length < 2) return;

  const avgVolume = fifteenMinAgo.reduce((s, v) => s + v.volume, 0) / fifteenMinAgo.length;
  if (avgVolume === 0) return;

  const ratio = currentVolume / avgVolume;
  if (ratio >= 3) {
    const market = marketCache.find(m =>
      m.tokens && m.tokens.some(t => t.token_id === tokenId)
    );
    if (!market) return;

    const liquidity = parseFloat(market.liquidity || 0);
    if (liquidity < 10000) return;

    const signal = {
      id: `vs_${tokenId}_${now}`,
      type: 'VOLUME_SPIKE',
      tokenId,
      marketId: market.id,
      marketTitle: market.question,
      ratio: ratio.toFixed(2),
      strength: ratio >= 5 ? 3 : ratio >= 4 ? 2 : 1,
      ts: now
    };
    addSignal(signal);
  }
}

function addSignal(signal) {
  // Deduplicate by market+type in last 5 min
  const exists = signals.find(s =>
    s.marketId === signal.marketId &&
    s.type === signal.type &&
    signal.ts - s.ts < 5 * 60 * 1000
  );
  if (exists) return;

  signals.unshift(signal);
  signals = signals.slice(0, 100); // keep last 100

  broadcast({ type: 'new_signal', signal });
  console.log(`[SIGNAL] ${signal.type} on ${signal.marketTitle?.slice(0, 50)}`);
}

function generateSignalsFromMarkets(markets) {
  markets.forEach(market => {
    if (!market.tokens) return;
    market.tokens.forEach(token => {
      const tokenId = token.token_id;
      const price = parseFloat(token.price || 0);
      const liquidity = parseFloat(market.liquidity || 0);
      const volume24h = parseFloat(market.volume24hr || 0);

      if (liquidity < 10000) return;

      // Whale trade simulation check
      if (volume24h > 5000) {
        const lastSig = signals.find(s =>
          s.marketId === market.id && s.type === 'WHALE_TRADE' &&
          Date.now() - s.ts < 60 * 60 * 1000
        );
        if (!lastSig) {
          addSignal({
            id: `wt_${tokenId}_${Date.now()}`,
            type: 'WHALE_TRADE',
            tokenId,
            marketId: market.id,
            marketTitle: market.question,
            volume: volume24h,
            strength: volume24h > 50000 ? 3 : volume24h > 20000 ? 2 : 1,
            ts: Date.now()
          });
        }
      }
    });
  });
}

// ==================== MARKET FETCH ====================
async function fetchMarkets() {
  try {
    console.log('[GAMMA] Fetching markets...');
    const now = new Date().toISOString();
    const res = await axios.get(`${GAMMA_API}/markets`, {
      params: {
        active: true,
        closed: false,
        limit: 100,
        order: 'volume24hr',
        ascending: false
      },
      timeout: 15000
    });

    let markets = res.data;
    if (!Array.isArray(markets)) {
      markets = markets.markets || markets.data || [];
    }

    // Filter: active, not resolved, end_date > now
    markets = markets.filter(m => {
      if (!m.active) return false;
      if (m.closed || m.resolved) return false;
      if (m.end_date_iso && new Date(m.end_date_iso) <= new Date()) return false;
      return true;
    });

    marketCache = markets;
    console.log(`[GAMMA] Got ${markets.length} active markets`);

    // Subscribe to top 50 token IDs via WS
    const tokenIds = [];
    markets.slice(0, 50).forEach(m => {
      if (m.tokens) m.tokens.forEach(t => tokenIds.push(t.token_id));
    });

    tokenIds.forEach(id => subscribedTokens.add(id));

    if (!polyWs || polyWs.readyState !== WebSocket.OPEN) {
      connectPolymarketWS(tokenIds);
    }

    generateSignalsFromMarkets(markets);
    broadcast({ type: 'markets_update', markets, count: markets.length });
    return markets;
  } catch (err) {
    console.error('[GAMMA] Error:', err.message);
    broadcast({ type: 'error', message: 'Помилка завантаження ринків: ' + err.message });
    return [];
  }
}

async function fetchOrderbook(tokenId) {
  try {
    const res = await axios.get(`${CLOB_API}/book`, {
      params: { token_id: tokenId },
      timeout: 10000
    });
    return res.data;
  } catch(e) {
    return null;
  }
}

async function fetchMarketTrades(conditionId) {
  try {
    const res = await axios.get(`${CLOB_API}/trades`, {
      params: { market: conditionId, limit: 20 },
      timeout: 10000
    });
    return res.data;
  } catch(e) {
    return null;
  }
}

// ==================== AI PROBABILITY MODEL ====================
function computeAIProb(market, token) {
  const basePrice = parseFloat(token.price || 0.5);
  const liquidity = parseFloat(market.liquidity || 0);
  const volume24h = parseFloat(market.volume24hr || 0);

  // Momentum factor from price history
  const tokenId = token.token_id;
  const history = priceHistory[tokenId] || [];
  let momentum = 0;
  if (history.length >= 2) {
    const recent = history[history.length - 1].price;
    const older = history[0].price;
    momentum = (recent - older) * 0.1; // small weight
  }

  // Volume confirmation
  const volFactor = volume24h > 100000 ? 0.02 :
                    volume24h > 10000  ? 0.01 : 0;

  // Compute AI prob
  let aiProb = basePrice + momentum + volFactor;
  aiProb = Math.max(0.01, Math.min(0.99, aiProb));

  const edge = aiProb - basePrice;

  // Decision
  let decision = 'PASS';
  if (edge > 0.05) decision = 'BUY_YES';
  else if (edge < -0.05) decision = 'BUY_NO';

  return { basePrice, aiProb, edge, decision };
}

function computeKelly(bankroll, prob, odds = 1) {
  const q = 1 - prob;
  const kelly = (prob * odds - q) / odds;
  const fractional = kelly * 0.25; // 25% Kelly
  const betSize = Math.min(bankroll * fractional, bankroll * 0.05);
  return { kelly, fractional, betSize: Math.max(0, betSize) };
}

// ==================== API ROUTES ====================
app.get('/api/markets', async (req, res) => {
  if (marketCache.length === 0) {
    await fetchMarkets();
  }
  res.json({ markets: marketCache, count: marketCache.length, ts: Date.now() });
});

app.get('/api/market/:id', async (req, res) => {
  const market = marketCache.find(m => m.id === req.params.id || m.condition_id === req.params.id);
  if (!market) return res.status(404).json({ error: 'Ринок не знайдено' });

  const analysis = [];
  if (market.tokens) {
    for (const token of market.tokens) {
      const ai = computeAIProb(market, token);
      const ob = await fetchOrderbook(token.token_id);
      analysis.push({ token, ai, orderbook: ob });
    }
  }
  res.json({ market, analysis });
});

app.get('/api/orderbook/:tokenId', async (req, res) => {
  const ob = await fetchOrderbook(req.params.tokenId);
  if (!ob) return res.status(503).json({ error: 'НЕМАЄ LIVE ДАНИХ — СИСТЕМА НЕ ПРАЦЮЄ' });
  res.json(ob);
});

app.get('/api/trades/:conditionId', async (req, res) => {
  const trades = await fetchMarketTrades(req.params.conditionId);
  if (!trades) return res.status(503).json({ error: 'НЕМАЄ LIVE ДАНИХ — СИСТЕМА НЕ ПРАЦЮЄ' });
  res.json(trades);
});

app.get('/api/signals', (req, res) => {
  res.json({ signals, count: signals.length });
});

app.post('/api/kelly', (req, res) => {
  const { bankroll, prob } = req.body;
  if (!bankroll || !prob) return res.status(400).json({ error: 'Потрібен bankroll та prob' });
  const result = computeKelly(parseFloat(bankroll), parseFloat(prob));
  res.json(result);
});

app.get('/api/analysis/:marketId', async (req, res) => {
  const market = marketCache.find(m =>
    m.id === req.params.marketId || m.condition_id === req.params.marketId
  );
  if (!market) return res.status(404).json({ error: 'Ринок не знайдено' });

  const analysis = (market.tokens || []).map(token => {
    const ai = computeAIProb(market, token);
    const kelly = computeKelly(1000, ai.aiProb);
    return { token, ...ai, kelly };
  });

  res.json({ market, analysis, signals: signals.filter(s => s.marketId === market.id) });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    markets: marketCache.length,
    signals: signals.length,
    ws: polyWs ? polyWs.readyState : -1,
    ts: Date.now()
  });
});

// ==================== CLIENT WS ====================
wss.on('connection', (ws) => {
  activeClients.add(ws);
  console.log('[WS] Client connected. Total:', activeClients.size);

  // Send current state
  ws.send(JSON.stringify({
    type: 'init',
    markets: marketCache,
    signals: signals.slice(0, 20),
    wsStatus: polyWs ? polyWs.readyState === WebSocket.OPEN : false
  }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe_orderbook') {
        const ob = await fetchOrderbook(msg.tokenId);
        ws.send(JSON.stringify({ type: 'orderbook', tokenId: msg.tokenId, data: ob }));
      }
    } catch(e) {}
  });

  ws.on('close', () => {
    activeClients.delete(ws);
    console.log('[WS] Client disconnected. Total:', activeClients.size);
  });
});

// ==================== INIT ====================
const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  await fetchMarkets();
  // Auto-refresh every 60s
  setInterval(fetchMarkets, 60 * 1000);
});
