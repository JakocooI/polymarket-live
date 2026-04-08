# 🔷 Polymarket Intelligence System

Система реального часу для аналізу прогнозних ринків Polymarket.

---

## Архітектура

```
frontend (React)  ←→  backend (Node.js/Express + WS)  ←→  Polymarket APIs
                                                              ├── Gamma API (markets)
                                                              ├── CLOB API (orderbook, trades)
                                                              └── WebSocket (live prices)
```

---

## Швидкий старт (локально)

### 1. Backend

```bash
cd backend
npm install
npm start
# Сервер запуститься на http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
npm start
# Інтерфейс відкриється на http://localhost:3000
```

---

## Docker (рекомендовано)

```bash
docker-compose up --build
# Frontend: http://localhost:3000
# Backend:  http://localhost:3001
```

---

## API Endpoints

| Endpoint | Метод | Опис |
|---|---|---|
| `/api/markets` | GET | Всі активні ринки |
| `/api/market/:id` | GET | Деталі ринку |
| `/api/orderbook/:tokenId` | GET | Книга ордерів |
| `/api/trades/:conditionId` | GET | Останні угоди |
| `/api/signals` | GET | Торгові сигнали |
| `/api/analysis/:marketId` | GET | AI аналіз ринку |
| `/api/kelly` | POST | Розрахунок Kelly |
| `/api/health` | GET | Статус системи |

---

## WebSocket Protocol

**Підключення:** `ws://localhost:3001`

**Вхідні повідомлення (від сервера):**

```json
{ "type": "init", "markets": [...], "signals": [...] }
{ "type": "markets_update", "markets": [...], "count": 87 }
{ "type": "new_signal", "signal": { "type": "PRICE_JUMP", ... } }
{ "type": "price_update", "tokenId": "...", "data": {...} }
{ "type": "error", "message": "..." }
```

**Вихідні повідомлення (до сервера):**

```json
{ "type": "subscribe_orderbook", "tokenId": "..." }
```

---

## Сигнальний движок

| Тип сигналу | Умова | Фільтр |
|---|---|---|
| PRICE_JUMP | ≥8% за 3 хв | ліквідність ≥ $10K |
| VOLUME_SPIKE | ≥3x avg (15 хв) | ліквідність ≥ $10K |
| WHALE_TRADE | обсяг > $5K | ліквідність ≥ $10K |

**Сила сигналу:**
- ★☆☆ — слабкий
- ★★☆ — середній  
- ★★★ — сильний

---

## AI Модель

```
AI_prob = market_price + momentum_factor + volume_factor
edge    = AI_prob - market_price

edge > +5%  → BUY YES
edge < -5%  → BUY NO
інакше      → PASS
```

---

## Kelly Criterion

```
kelly    = (p * odds - q) / odds
bet_size = kelly * 0.25 * bankroll
max_bet  = bankroll * 5%
```

---

## Розгортання (Production)

### Railway / Render / Fly.io

```bash
# Backend
cd backend
# Встановіть змінну PORT в налаштуваннях сервісу
# Деплойте як Node.js сервіс

# Frontend
cd frontend
npm run build
# Завантажте папку build на CDN (Netlify/Vercel/Cloudflare Pages)
# Встановіть REACT_APP_BACKEND_WS та REACT_APP_BACKEND_API у змінні середовища
```

### Змінні середовища

**Backend:**
```
PORT=3001
NODE_ENV=production
```

**Frontend:**
```
REACT_APP_BACKEND_WS=wss://your-backend.com
REACT_APP_BACKEND_API=https://your-backend.com/api
```

---

## Polymarket API (без ключів)

Система використовує публічні API:
- **Gamma API:** `https://gamma-api.polymarket.com`
- **CLOB API:** `https://clob.polymarket.com`
- **WebSocket:** `wss://ws-subscriptions-clob.polymarket.com/ws/market`

Ключі API **не потрібні** для читання даних.

---

## Правила фільтрації ринків

Система показує ЛИШЕ ринки де:
- `active = true`
- `closed = false` і `resolved = false`
- `end_date > поточна дата`
- ліквідність ≥ $10,000 (для сигналів)

---

## Структура проєкту

```
polymarket-system/
├── backend/
│   ├── server.js          # Express + WS + Polymarket integration
│   ├── package.json
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Main React app (Ukrainian UI)
│   │   └── index.js
│   ├── public/index.html
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
└── README.md
```

---

## Вимоги

- Node.js ≥ 18
- npm ≥ 9
- (опціонально) Docker + Docker Compose

---

*Система використовує виключно реальні дані з Polymarket API.*  
*При відсутності з'єднання відображається: "НЕМАЄ LIVE ДАНИХ — СИСТЕМА НЕ ПРАЦЮЄ"*
