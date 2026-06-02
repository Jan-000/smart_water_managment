# Smart Home Water MVP - Logic Flow

This file documents the simplified app flow.

## Main Blocks

```mermaid
flowchart TD
  A[Frontend simulation] -->|GET /api/forecast on load| B[Fastify backend]
  A -->|POST /api/manage-water on button click| B
  B --> C[Open-Meteo hourly rainfall]
  B --> D[OpenAI decision or fallback rules]
  A --> E[SVG house, clock, timeline slider]
```

## Startup Flow

```mermaid
sequenceDiagram
  participant FE as Frontend
  participant BE as Backend
  participant WX as Open-Meteo

  FE->>FE: set roof 2500 L, tank 2500 L, garden 30%
  FE->>BE: GET /api/forecast
  BE->>WX: fetch 7 days hourly rainfall
  BE->>FE: return rain mm and collected liters per hour
  FE->>FE: start simulation clock at 1 forecast hour per real second
```

## Simulation Rules

- Roof capacity is `5000 L`.
- Garden tank capacity is `5000 L`.
- Roof surface is `100 m2`, so `1 mm` rain adds `100 L` to roof storage.
- Roof storage evaporates `5 L/hour`.
- Garden humidity decreases `1%` every third dry forecast hour.
- Garden humidity increases `3%/hour` when it rains.
- Releasing `100 L` from the garden tank to soil increases garden humidity by `1%`.
- The timeline slider is a read-only live progress indicator.

## Manage Water Flow

```mermaid
flowchart TD
  A[User clicks Manage water] --> B[Frontend sends current state]
  B --> C[Frontend sends all remaining forecast rainfall as one total]
  C --> D[Backend sends cumulative rain total to OpenAI]
  D --> G[OpenAI or fallback decision]
  G --> E[Return liters to move]
  E --> F[Frontend applies decision at current simulation hour]
```

The AI receives:

- current simulation time
- roof water liters
- garden tank liters
- garden soil humidity
- cumulative remaining rainfall

The AI returns:

- `targetRoofLiters`
- `roofToGardenTankLiters`
- `gardenTankToSoilLiters`
- `reasoning`

The decision goal is to keep garden soil at least `40%`, preserve at least `500 L` on the roof, and anticipate rain that may fill the roof.
