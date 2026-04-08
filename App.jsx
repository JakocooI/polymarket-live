import { useState, useEffect, useRef, useCallback } from "react";

// ==================== CONFIG ====================
const BACKEND_WS = "ws://localhost:3001";
const BACKEND_API = "http://localhost:3001/api";

// ==================== HELPERS ====================
const fmt = (n, d = 2) => (isNaN(n) ? "—" : Number(n).toFixed(d));
const fmtPct = (n) => `${fmt(n * 100)}%`;
const fmtUSD = (n) => {
  if (isNaN(n) || n === null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Number(n).toFixed(0)}`;
};
const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}с тому`;
  if (s < 3600) return `${Math.floor(s / 60)}хв тому`;
  return `${Math.floor(s / 3600)}год тому`;
};

const SIGNAL_LABELS = {
  PRICE_JUMP: "Стрибок ціни",
  VOLUME_SPIKE: "Сплеск обсягу",
  WHALE_TRADE: "Кит",
  SPREAD_TIGHT: "Тісний спред",
};

const SIGNAL_COLORS = {
  PRICE_JUMP: "#f59e0b",
  VOLUME_SPIKE: "#3b82f6",
  WHALE_TRADE: "#8b5cf6",
  SPREAD_TIGHT: "#10b981",
};

const DECISION_LABELS = {
  BUY_YES: "КУПИТИ YES",
  BUY_NO: "КУПИТИ NO",
  PASS: "ПРОПУСТИТИ",
};
const DECISION_COLORS = {
  BUY_YES: "#10b981",
  BUY_NO: "#ef4444",
  PASS: "#6b7280",
};

// ==================== COMPONENTS ====================
function StatusDot({ connected }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: connected ? "#10b981" : "#ef4444",
        boxShadow: connected ? "0 0 8px #10b981" : "0 0 8px #ef4444",
        animation: connected ? "pulse 2s infinite" : "none",
        marginRight: 6,
      }}
    />
  );
}

function SignalBadge({ signal }) {
  const color = SIGNAL_COLORS[signal.type] || "#fff";
  const stars = "★".repeat(signal.strength) + "☆".repeat(3 - signal.strength);
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color, fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>
          {SIGNAL_LABELS[signal.type] || signal.type}
        </span>
        <span style={{ color: "#f59e0b", fontSize: 11 }}>{stars}</span>
      </div>
      <div style={{ color: "#e2e8f0", fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>
        {signal.marketTitle?.slice(0, 70)}
        {signal.marketTitle?.length > 70 ? "..." : ""}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {signal.change && (
          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            Зміна: <b style={{ color: "#f59e0b" }}>{signal.change}%</b>
          </span>
        )}
        {signal.ratio && (
          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            Обсяг: <b style={{ color: "#3b82f6" }}>{signal.ratio}x</b>
          </span>
        )}
        {signal.volume && (
          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            Обсяг: <b style={{ color: "#8b5cf6" }}>{fmtUSD(signal.volume)}</b>
          </span>
        )}
        <span style={{ color: "#475569", fontSize: 11, marginLeft: "auto" }}>
          {timeAgo(signal.ts)}
        </span>
      </div>
    </div>
  );
}

function MarketRow({ market, onClick, selected }) {
  const token = market.tokens?.[0];
  const price = token ? parseFloat(token.price || 0) : 0;
  const pctYes = Math.round(price * 100);
  const liquidity = parseFloat(market.liquidity || 0);
  const vol24 = parseFloat(market.volume24hr || 0);

  return (
    <div
      onClick={() => onClick(market)}
      style={{
        background: selected
          ? "rgba(59,130,246,0.12)"
          : "rgba(255,255,255,0.03)",
        border: selected ? "1px solid #3b82f6" : "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 6,
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <div
        style={{
          color: "#e2e8f0",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.4,
          marginBottom: 8,
        }}
      >
        {market.question?.slice(0, 80)}
        {market.question?.length > 80 ? "..." : ""}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {/* Probability bar */}
        <div style={{ flex: 1, position: "relative" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.08)",
              borderRadius: 4,
              height: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pctYes}%`,
                height: "100%",
                background: `linear-gradient(90deg, #10b981, #3b82f6)`,
                borderRadius: 4,
                transition: "width 0.5s",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 2,
              fontSize: 10,
              color: "#64748b",
            }}
          >
            <span>YES {pctYes}%</span>
            <span>NO {100 - pctYes}%</span>
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 80 }}>
          <div style={{ color: "#94a3b8", fontSize: 10 }}>Ліквідність</div>
          <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>
            {fmtUSD(liquidity)}
          </div>
        </div>
        <div style={{ textAlign: "right", minWidth: 70 }}>
          <div style={{ color: "#94a3b8", fontSize: 10 }}>Обсяг 24г</div>
          <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 700 }}>
            {fmtUSD(vol24)}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ market, bankroll }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [orderbook, setOrderbook] = useState(null);

  useEffect(() => {
    if (!market) return;
    setLoading(true);
    const id = market.condition_id || market.id;
    fetch(`${BACKEND_API}/analysis/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setAnalysis(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch orderbook for first token
    const token = market.tokens?.[0];
    if (token?.token_id) {
      fetch(`${BACKEND_API}/orderbook/${token.token_id}`)
        .then((r) => r.json())
        .then(setOrderbook)
        .catch(() => {});
    }
  }, [market?.id]);

  if (!market)
    return (
      <div
        style={{
          color: "#475569",
          textAlign: "center",
          marginTop: 60,
          fontSize: 14,
        }}
      >
        ← Оберіть ринок для аналізу
      </div>
    );

  if (loading)
    return (
      <div style={{ color: "#64748b", textAlign: "center", marginTop: 40 }}>
        Завантаження...
      </div>
    );

  return (
    <div>
      <div
        style={{
          color: "#e2e8f0",
          fontWeight: 700,
          fontSize: 15,
          marginBottom: 16,
          lineHeight: 1.4,
        }}
      >
        {market.question}
      </div>

      {analysis?.analysis?.map((item, i) => {
        const kellyBet = bankroll > 0
          ? Math.min(bankroll * Math.max(0, item.kelly?.fractional || 0), bankroll * 0.05)
          : 0;
        const dec = item.decision || "PASS";
        return (
          <div
            key={i}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                color: "#94a3b8",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                marginBottom: 12,
              }}
            >
              ТОКЕН {i + 1}: {item.token?.outcome || "YES"}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {[
                ["Ринкова ймовірність", fmtPct(item.basePrice), "#94a3b8"],
                ["AI ймовірність", fmtPct(item.aiProb), "#3b82f6"],
                [
                  "Edge",
                  `${item.edge >= 0 ? "+" : ""}${fmt(item.edge * 100)}%`,
                  item.edge > 0.05
                    ? "#10b981"
                    : item.edge < -0.05
                    ? "#ef4444"
                    : "#f59e0b",
                ],
                [
                  "Розмір ставки",
                  bankroll > 0 ? fmtUSD(kellyBet) : "Задайте банкрол",
                  "#e2e8f0",
                ],
              ].map(([label, val, color]) => (
                <div
                  key={label}
                  style={{
                    background: "rgba(0,0,0,0.2)",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ color: "#64748b", fontSize: 10, marginBottom: 2 }}>
                    {label}
                  </div>
                  <div style={{ color, fontSize: 16, fontWeight: 800 }}>{val}</div>
                </div>
              ))}
            </div>

            <div
              style={{
                background: `${DECISION_COLORS[dec]}22`,
                border: `1px solid ${DECISION_COLORS[dec]}55`,
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{ fontSize: 18 }}>
                {dec === "BUY_YES" ? "✅" : dec === "BUY_NO" ? "❌" : "⏸"}
              </span>
              <div>
                <div
                  style={{
                    color: DECISION_COLORS[dec],
                    fontWeight: 800,
                    fontSize: 14,
                  }}
                >
                  {DECISION_LABELS[dec]}
                </div>
                <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                  Kelly 25% • Макс ризик 5% банкролу
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Orderbook preview */}
      {orderbook && (
        <div
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: 14,
            marginTop: 8,
          }}
        >
          <div
            style={{
              color: "#94a3b8",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 10,
            }}
          >
            КНИГА ОРДЕРІВ
          </div>
          {orderbook.SELL?.slice(0, 3).map((o, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#ef4444",
                marginBottom: 3,
              }}
            >
              <span>ПРОДАЖ {fmt(o.price)}</span>
              <span>{fmtUSD(o.size)}</span>
            </div>
          ))}
          <div
            style={{
              height: 1,
              background: "rgba(255,255,255,0.08)",
              margin: "6px 0",
            }}
          />
          {orderbook.BUY?.slice(0, 3).map((o, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#10b981",
                marginBottom: 3,
              }}
            >
              <span>КУПІВЛЯ {fmt(o.price)}</span>
              <span>{fmtUSD(o.size)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Market signals */}
      {analysis?.signals?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              color: "#94a3b8",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            СИГНАЛИ ЦЬОГО РИНКУ
          </div>
          {analysis.signals.map((s) => (
            <SignalBadge key={s.id} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioTab({ bankroll, setBankroll }) {
  const [bets, setBets] = useState([]);
  const [newBet, setNewBet] = useState({ market: "", outcome: "YES", amount: "", price: "" });
  const [total, setTotal] = useState(0);
  const [pnl, setPnl] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("pm_bets");
    if (saved) {
      const parsed = JSON.parse(saved);
      setBets(parsed);
      recalc(parsed);
    }
  }, []);

  const recalc = (b) => {
    const t = b.reduce((s, x) => s + parseFloat(x.amount || 0), 0);
    setTotal(t);
    // PnL = sum of resolved bets (simplified)
    const p = b.reduce((s, x) => s + parseFloat(x.pnl || 0), 0);
    setPnl(p);
  };

  const addBet = () => {
    if (!newBet.market || !newBet.amount) return;
    const bet = { ...newBet, id: Date.now(), ts: Date.now(), pnl: 0 };
    const updated = [bet, ...bets];
    setBets(updated);
    localStorage.setItem("pm_bets", JSON.stringify(updated));
    recalc(updated);
    setNewBet({ market: "", outcome: "YES", amount: "", price: "" });
  };

  const removeBet = (id) => {
    const updated = bets.filter((b) => b.id !== id);
    setBets(updated);
    localStorage.setItem("pm_bets", JSON.stringify(updated));
    recalc(updated);
  };

  const avgEdge = bets.length > 0
    ? bets.reduce((s, b) => s + parseFloat(b.edge || 0), 0) / bets.length
    : 0;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          ["Активні ставки", bets.length, "#e2e8f0"],
          ["Загальний ризик", fmtUSD(total), "#f59e0b"],
          ["PnL", `${pnl >= 0 ? "+" : ""}${fmtUSD(pnl)}`, pnl >= 0 ? "#10b981" : "#ef4444"],
        ].map(([label, val, color]) => (
          <div
            key={label}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div style={{ color: "#64748b", fontSize: 11 }}>{label}</div>
            <div style={{ color, fontSize: 20, fontWeight: 800, marginTop: 4 }}>
              {val}
            </div>
          </div>
        ))}
      </div>

      {/* Add bet form */}
      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            color: "#94a3b8",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            marginBottom: 12,
          }}
        >
          ДОДАТИ СТАВКУ
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Назва ринку"
            value={newBet.market}
            onChange={(e) => setNewBet((p) => ({ ...p, market: e.target.value }))}
            style={inputStyle}
          />
          <select
            value={newBet.outcome}
            onChange={(e) => setNewBet((p) => ({ ...p, outcome: e.target.value }))}
            style={{ ...inputStyle, width: 80 }}
          >
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
          <input
            placeholder="Сума $"
            type="number"
            value={newBet.amount}
            onChange={(e) => setNewBet((p) => ({ ...p, amount: e.target.value }))}
            style={{ ...inputStyle, width: 90 }}
          />
          <input
            placeholder="Ціна"
            type="number"
            value={newBet.price}
            onChange={(e) => setNewBet((p) => ({ ...p, price: e.target.value }))}
            style={{ ...inputStyle, width: 80 }}
          />
          <button onClick={addBet} style={btnStyle}>
            + Додати
          </button>
        </div>
      </div>

      {bets.length === 0 ? (
        <div style={{ color: "#475569", textAlign: "center", padding: 30 }}>
          Немає активних ставок
        </div>
      ) : (
        bets.map((bet) => (
          <div
            key={bet.id}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                background: bet.outcome === "YES" ? "#10b98122" : "#ef444422",
                color: bet.outcome === "YES" ? "#10b981" : "#ef4444",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {bet.outcome}
            </div>
            <div style={{ flex: 1, color: "#e2e8f0", fontSize: 13 }}>
              {bet.market.slice(0, 50)}
            </div>
            <div style={{ color: "#f59e0b", fontWeight: 700, fontSize: 13 }}>
              {fmtUSD(bet.amount)}
            </div>
            <button
              onClick={() => removeBet(bet.id)}
              style={{
                background: "none",
                border: "none",
                color: "#ef4444",
                cursor: "pointer",
                fontSize: 16,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  );
}

const inputStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "8px 12px",
  color: "#e2e8f0",
  fontSize: 13,
  outline: "none",
  flex: 1,
  minWidth: 120,
};

const btnStyle = {
  background: "#3b82f6",
  border: "none",
  borderRadius: 6,
  padding: "8px 16px",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

// ==================== MAIN APP ====================
export default function App() {
  const [tab, setTab] = useState("market");
  const [markets, setMarkets] = useState([]);
  const [signals, setSignals] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [priceUpdates, setPriceUpdates] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [bankroll, setBankroll] = useState(0);
  const [riskLevel, setRiskLevel] = useState("medium");
  const [minLiquidity, setMinLiquidity] = useState(10000);
  const [liveCount, setLiveCount] = useState(0);

  const ws = useRef(null);
  const reconnectTimer = useRef(null);

  const connectWS = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) return;

    ws.current = new WebSocket(BACKEND_WS);

    ws.current.onopen = () => {
      setWsConnected(true);
      setApiError(null);
    };

    ws.current.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "init":
            if (msg.markets?.length) {
              setMarkets(msg.markets);
              setLoading(false);
              setLastUpdate(Date.now());
              setLiveCount(msg.markets.length);
            }
            if (msg.signals) setSignals(msg.signals);
            break;
          case "markets_update":
            if (msg.markets?.length) {
              setMarkets(msg.markets);
              setLastUpdate(Date.now());
              setLiveCount(msg.count || msg.markets.length);
            }
            break;
          case "new_signal":
            if (msg.signal) setSignals((prev) => [msg.signal, ...prev].slice(0, 50));
            break;
          case "price_update":
            if (msg.tokenId) {
              setPriceUpdates((prev) => ({
                ...prev,
                [msg.tokenId]: { ...msg.data, ts: Date.now() },
              }));
            }
            break;
          case "ws_status":
            // Polymarket WS status
            break;
          case "error":
            setApiError(msg.message);
            break;
        }
      } catch (err) {}
    };

    ws.current.onclose = () => {
      setWsConnected(false);
      reconnectTimer.current = setTimeout(connectWS, 3000);
    };

    ws.current.onerror = () => {
      setApiError("НЕМАЄ LIVE ДАНИХ — СИСТЕМА НЕ ПРАЦЮЄ");
      setLoading(false);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("pm_bankroll");
    if (saved) setBankroll(parseFloat(saved));
    connectWS();
    return () => {
      ws.current?.close();
      clearTimeout(reconnectTimer.current);
    };
  }, [connectWS]);

  const handleBankrollChange = (v) => {
    setBankroll(v);
    localStorage.setItem("pm_bankroll", v);
  };

  const filteredMarkets = markets
    .filter((m) => {
      if (parseFloat(m.liquidity || 0) < minLiquidity) return false;
      if (searchQuery) {
        return m.question?.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    })
    .slice(0, 100);

  const TABS = [
    { id: "market", label: "Ринок" },
    { id: "analysis", label: "Аналіз" },
    { id: "signals", label: `Сигнали${signals.length ? ` (${signals.length})` : ""}` },
    { id: "portfolio", label: "Портфоліо" },
    { id: "settings", label: "Налаштування" },
  ];

  return (
    <div
      style={{
        background: "#070b14",
        minHeight: "100vh",
        color: "#e2e8f0",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 2px; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes ticker { from { transform: translateX(100%); } to { transform: translateX(-100%); } }
        .market-row:hover { background: rgba(255,255,255,0.06) !important; }
      `}</style>

      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(10px)",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 14,
            }}
          >
            P
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: 0.5 }}>
              Polymarket Intelligence
            </div>
            <div style={{ color: "#475569", fontSize: 10 }}>
              Система аналізу прогнозних ринків
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Status indicators */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 11 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <StatusDot connected={wsConnected} />
            <span style={{ color: wsConnected ? "#10b981" : "#ef4444" }}>
              {wsConnected ? "ПІДКЛЮЧЕНО" : "ВІДКЛЮЧЕНО"}
            </span>
          </div>
          {liveCount > 0 && (
            <span style={{ color: "#64748b" }}>
              {liveCount} ринків
            </span>
          )}
          {lastUpdate && (
            <span style={{ color: "#475569" }}>
              {timeAgo(lastUpdate)}
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {apiError && (
        <div
          style={{
            background: "#ef444422",
            border: "1px solid #ef444466",
            borderRadius: 0,
            padding: "12px 24px",
            color: "#ef4444",
            fontWeight: 700,
            fontSize: 13,
            textAlign: "center",
          }}
        >
          ⚠ {apiError}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "12px 24px 0",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? "rgba(59,130,246,0.15)" : "transparent",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #3b82f6" : "2px solid transparent",
              color: tab === t.id ? "#3b82f6" : "#64748b",
              padding: "8px 16px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: tab === t.id ? 700 : 400,
              fontSize: 12,
              letterSpacing: 0.5,
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
        {/* РИНОК TAB */}
        {tab === "market" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 400px",
              gap: 20,
              animation: "fadeIn 0.3s",
            }}
          >
            <div>
              <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  placeholder="🔍 Пошук ринків..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <div style={{ color: "#475569", fontSize: 12, whiteSpace: "nowrap" }}>
                  {filteredMarkets.length} ринків
                </div>
              </div>

              {loading && !apiError && (
                <div style={{ color: "#64748b", textAlign: "center", padding: 40 }}>
                  Підключення до Polymarket...
                </div>
              )}

              {!loading && !wsConnected && markets.length === 0 && (
                <div
                  style={{
                    background: "#ef444415",
                    border: "1px solid #ef444444",
                    borderRadius: 10,
                    padding: 30,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                  <div style={{ color: "#ef4444", fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
                    НЕМАЄ LIVE ДАНИХ — СИСТЕМА НЕ ПРАЦЮЄ
                  </div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>
                    Переконайтеся що backend запущено на localhost:3001
                  </div>
                </div>
              )}

              {filteredMarkets.map((m) => (
                <MarketRow
                  key={m.id}
                  market={m}
                  onClick={setSelectedMarket}
                  selected={selectedMarket?.id === m.id}
                />
              ))}
            </div>

            {/* Right: signals panel */}
            <div>
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                LIVE СИГНАЛИ
              </div>
              {signals.length === 0 ? (
                <div style={{ color: "#475569", fontSize: 13 }}>
                  Очікування сигналів...
                </div>
              ) : (
                signals.slice(0, 15).map((s) => <SignalBadge key={s.id} signal={s} />)
              )}
            </div>
          </div>
        )}

        {/* АНАЛІЗ TAB */}
        {tab === "analysis" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "360px 1fr",
              gap: 20,
              animation: "fadeIn 0.3s",
            }}
          >
            <div>
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                ОБЕРІТЬ РИНОК
              </div>
              <input
                placeholder="🔍 Пошук..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ ...inputStyle, marginBottom: 10, width: "100%" }}
              />
              <div style={{ maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
                {filteredMarkets.slice(0, 30).map((m) => (
                  <MarketRow
                    key={m.id}
                    market={m}
                    onClick={setSelectedMarket}
                    selected={selectedMarket?.id === m.id}
                  />
                ))}
              </div>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: 20,
                maxHeight: "calc(100vh - 180px)",
                overflowY: "auto",
              }}
            >
              <AnalysisPanel market={selectedMarket} bankroll={bankroll} />
            </div>
          </div>
        )}

        {/* СИГНАЛИ TAB */}
        {tab === "signals" && (
          <div style={{ animation: "fadeIn 0.3s", maxWidth: 700 }}>
            <div
              style={{
                color: "#94a3b8",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                marginBottom: 16,
              }}
            >
              ТОРГОВІ СИГНАЛИ ({signals.length})
            </div>
            {signals.length === 0 ? (
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: 40,
                  textAlign: "center",
                  color: "#475569",
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
                <div>Моніторинг ринків...</div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Сигнали з'являться при виявленні патернів
                </div>
              </div>
            ) : (
              signals.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    const m = markets.find((x) => x.id === s.marketId);
                    if (m) { setSelectedMarket(m); setTab("analysis"); }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <SignalBadge signal={s} />
                </div>
              ))
            )}
          </div>
        )}

        {/* ПОРТФОЛІО TAB */}
        {tab === "portfolio" && (
          <div style={{ animation: "fadeIn 0.3s", maxWidth: 800 }}>
            <PortfolioTab bankroll={bankroll} setBankroll={setBankroll} />
          </div>
        )}

        {/* НАЛАШТУВАННЯ TAB */}
        {tab === "settings" && (
          <div style={{ animation: "fadeIn 0.3s", maxWidth: 600 }}>
            <div
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: 24,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  marginBottom: 16,
                }}
              >
                БАНКРОЛ ТА РИЗИК
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ color: "#64748b", fontSize: 12, display: "block", marginBottom: 6 }}>
                  Банкрол (USD)
                </label>
                <input
                  type="number"
                  value={bankroll || ""}
                  onChange={(e) => handleBankrollChange(parseFloat(e.target.value) || 0)}
                  placeholder="напр. 1000"
                  style={{ ...inputStyle, width: "100%" }}
                />
                {bankroll > 0 && (
                  <div style={{ color: "#64748b", fontSize: 11, marginTop: 6 }}>
                    Макс ставка (5%): {fmtUSD(bankroll * 0.05)}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ color: "#64748b", fontSize: 12, display: "block", marginBottom: 6 }}>
                  Рівень ризику
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {["low", "medium", "high"].map((lvl) => {
                    const labels = { low: "Низький", medium: "Середній", high: "Високий" };
                    const colors = { low: "#10b981", medium: "#f59e0b", high: "#ef4444" };
                    return (
                      <button
                        key={lvl}
                        onClick={() => setRiskLevel(lvl)}
                        style={{
                          flex: 1,
                          padding: "8px 0",
                          background: riskLevel === lvl ? `${colors[lvl]}22` : "rgba(255,255,255,0.04)",
                          border: riskLevel === lvl ? `1px solid ${colors[lvl]}` : "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 6,
                          color: riskLevel === lvl ? colors[lvl] : "#64748b",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {labels[lvl]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label style={{ color: "#64748b", fontSize: 12, display: "block", marginBottom: 6 }}>
                  Мін. ліквідність: {fmtUSD(minLiquidity)}
                </label>
                <input
                  type="range"
                  min="1000"
                  max="100000"
                  step="1000"
                  value={minLiquidity}
                  onChange={(e) => setMinLiquidity(parseInt(e.target.value))}
                  style={{ width: "100%", accentColor: "#3b82f6" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", color: "#475569", fontSize: 10, marginTop: 2 }}>
                  <span>$1K</span><span>$100K</span>
                </div>
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: 24,
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  marginBottom: 16,
                }}
              >
                СТРАТЕГІЯ KELLY
              </div>
              <div style={{ color: "#64748b", fontSize: 12, lineHeight: 1.8 }}>
                <div>✦ Фракція Kelly: <span style={{ color: "#3b82f6", fontWeight: 700 }}>25%</span></div>
                <div>✦ Макс ризик на ставку: <span style={{ color: "#f59e0b", fontWeight: 700 }}>5% банкролу</span></div>
                <div>✦ Мін edge для входу: <span style={{ color: "#10b981", fontWeight: 700 }}>&gt; 5%</span></div>
                <div>✦ Мін ліквідність ринку: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{fmtUSD(minLiquidity)}</span></div>
                <div>✦ Мін сила сигналу: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>★★ (середній)</span></div>
              </div>
            </div>

            {/* System status */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: 20,
                marginTop: 16,
              }}
            >
              <div
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  marginBottom: 12,
                }}
              >
                СТАТУС СИСТЕМИ
              </div>
              {[
                ["WebSocket", wsConnected, wsConnected ? "Підключено" : "Відключено"],
                ["Ринки", markets.length > 0, `${markets.length} активних`],
                ["Сигнали", signals.length > 0, `${signals.length} виявлено`],
                ["Оновлення", !!lastUpdate, lastUpdate ? timeAgo(lastUpdate) : "—"],
              ].map(([name, ok, val]) => (
                <div
                  key={name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <span style={{ color: "#64748b", fontSize: 12 }}>{name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <StatusDot connected={ok} />
                    <span style={{ color: ok ? "#10b981" : "#ef4444", fontSize: 12 }}>{val}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
