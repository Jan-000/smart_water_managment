# Smart Home Water MVP

TypeScript MVP for a green-roof and garden-tank water simulation.

## Structure

- `backend`: Fastify API for rainfall forecast and AI water-management decisions.
- `frontend`: Vite + React + TypeScript dashboard with SVG house, liters display, digital clock, rain animation, and timeline slider.
- `shared`: API contracts shared by frontend and backend.

## Simulation Rules

- Initial roof water storage: `2500 L`.
- Initial garden tank storage: `2500 L`.
- Initial garden soil humidity: `30%`.
- Roof water capacity: `5000 L`.
- Garden tank capacity: `5000 L`.
- Roof surface: `100 m2`.
- Rain capture: `1 mm` rain on the roof adds `100 L`.
- Roof water evaporates at `5 L/hour`, independent of weather.
- Garden soil humidity decreases by `1%` every third dry forecast hour.
- Garden soil humidity increases by `3%/hour` when it rains.
- Releasing `100 L` from the garden tank to soil increases garden soil humidity by `1%`.
- Simulation clock advances automatically.
- The fetched 7-day rainfall forecast is treated as the exact weather that will happen.
- The timeline slider is a read-only live progress indicator.

## API Contracts

Shared TypeScript contracts live in `shared/src/index.ts`.

### `GET /health`

Returns:

```json
{
  "ok": true,
  "openAi": {
    "configured": true,
    "validFormat": true,
    "model": "gpt-5-nano"
  }
}
```

### `GET /api/forecast`

Fetches 7 days of hourly rainfall from Open-Meteo and returns:

```json
{
  "fetchedAt": "2026-06-02T10:00:00.000Z",
  "location": {
    "latitude": 52.52,
    "longitude": 13.41,
    "timezone": "Europe/Berlin"
  },
  "roofSurfaceM2": 100,
  "forecast": [
    {
      "time": "2026-06-02T10:00",
      "rainMm": 1.2,
      "collectedLiters": 120
    }
  ]
}
```

### `POST /api/manage-water`

Request:

```json
{
  "currentState": {
    "simulationTime": "2026-06-02T10:00",
    "roofWaterLiters": 2500,
    "gardenTankLiters": 2500,
    "gardenSoilHumidityPercent": 30
  },
  "remainingRainTotal": {
    "hours": 168,
    "rainMm": 8.4,
    "collectedLiters": 840
  }
}
```

Returns:

```json
{
  "createdAt": "2026-06-02T10:00:00.000Z",
  "decision": {
    "targetRoofLiters": 2500,
    "roofToGardenTankLiters": 0,
    "gardenTankToSoilLiters": 1000,
    "reasoning": "Raise garden soil to at least 40% while preserving roof reserve."
  }
}
```

The backend asks OpenAI when `OPENAI_API_KEY` is configured. Without a key, it uses fallback rules that preserve at least `500 L` on the roof, avoid roof overflow from future rainfall, and irrigate only when needed to keep garden humidity at least `40%`.

## Environment

Copy `.env.example` to `.env` at the project root and fill in:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPEN_METEO_LATITUDE`
- `OPEN_METEO_LONGITUDE`
- `OPEN_METEO_TIMEZONE`

## Run Locally

```bash
npm install
npm run dev
```

The dev command builds `shared` once, then keeps `shared`, the backend, and the frontend in watch mode. Backend source changes automatically restart the Fastify server via `tsx watch` and rebuild `backend/dist`; shared contract changes are rebuilt by TypeScript watch.

Frontend: `http://localhost:5173`

Backend: `http://localhost:4000`

If port `4000` is occupied, run the backend on another port and point Vite at it:

```bash
PORT=4001 npm run dev --workspace backend
VITE_BACKEND_URL=http://localhost:4001 npm run dev --workspace frontend
```
