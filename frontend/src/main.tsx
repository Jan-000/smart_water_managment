import React from "react";
import ReactDOM from "react-dom/client";
import { ChevronRight, CloudRain, Droplet } from "lucide-react";
import type {
  ApiForecastResponse,
  ApiManageWaterResponse,
  RainForecastHour,
  SystemState,
  WaterManagementDecision
} from "@smart-home/shared";
import "./styles.css";

const ROOF_CAPACITY_LITERS = 5000;
const GARDEN_TANK_CAPACITY_LITERS = 5000;
const INITIAL_ROOF_LITERS = 2500;
const INITIAL_GARDEN_TANK_LITERS = 2500;
const INITIAL_GARDEN_HUMIDITY_PERCENT = 30;
const SIMULATION_SPEED = 3600;
const HOUR_MS = 60 * 60 * 1000;
const DECISION_ANIMATION_MS = 7000;
const FORECAST_DAYS = 7;
const WEATHER_FETCH_DELAY_MS = 5000;
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") ?? "";

type DecisionEvent = {
  hourIndex: number;
  decision: WaterManagementDecision;
};

type MetricTrend = "up" | "down" | "none";

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

function App() {
  const [forecast, setForecast] = React.useState<RainForecastHour[]>([]);
  const [isForecastLoading, setIsForecastLoading] = React.useState(true);
  const [realStartMs, setRealStartMs] = React.useState(Date.now());
  const [baseElapsedMs, setBaseElapsedMs] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [isSimulationPaused, setIsSimulationPaused] = React.useState(false);
  const [decisionEvents, setDecisionEvents] = React.useState<DecisionEvent[]>([]);
  const [lastDecision, setLastDecision] = React.useState<WaterManagementDecision | undefined>();
  const [lastDecisionAt, setLastDecisionAt] = React.useState<string | undefined>();
  const [forecastError, setForecastError] = React.useState<string | undefined>();
  const [manageError, setManageError] = React.useState<string | undefined>();
  const [isManaging, setIsManaging] = React.useState(false);
  const [isApplyingDecision, setIsApplyingDecision] = React.useState(false);
  const [activeTransferDecision, setActiveTransferDecision] = React.useState<WaterManagementDecision | undefined>();
  const [isIntroExpanded, setIsIntroExpanded] = React.useState(false);
  const hasStartedForecastLoad = React.useRef(false);

  const maxHourIndex = Math.max(0, forecast.length - 1);
  const liveElapsedMs = isSimulationPaused ? baseElapsedMs : getElapsedMs(nowMs);
  const liveHourIndex = Math.min(maxHourIndex, Math.max(0, Math.floor(liveElapsedMs / HOUR_MS)));
  const displayHourIndex = liveHourIndex;
  const displayedState = React.useMemo(
    () => simulateState(forecast, displayHourIndex, decisionEvents),
    [forecast, displayHourIndex, decisionEvents]
  );
  const displayedRain = forecast[displayHourIndex]?.rainMm ?? 0;
  const roofStorageTrend = useMetricTrend(displayedState.roofWaterLiters);
  const gardenTankTrend = useMetricTrend(displayedState.gardenTankLiters);
  const gardenHumidityTrend = useMetricTrend(displayedState.gardenSoilHumidityPercent);

  async function initializeForecast() {
    setIsForecastLoading(true);
    setForecastError(undefined);
    try {
      await wait(WEATHER_FETCH_DELAY_MS);
      const response = await fetch(apiUrl("/api/forecast"));
      if (!response.ok) {
        throw new Error(`Forecast request failed with HTTP ${response.status}`);
      }

      const data = (await response.json()) as ApiForecastResponse;
      if (data.forecast.length === 0) {
        throw new Error("Forecast response did not include hourly rainfall data.");
      }

      setForecast(data.forecast);
      setDecisionEvents([]);
      setLastDecision(undefined);
      setLastDecisionAt(undefined);
      setIsApplyingDecision(false);
      setActiveTransferDecision(undefined);
      resetClockToHour(0);
    } catch (error) {
      setForecast([]);
      setForecastError(error instanceof Error ? error.message : "Could not load rainfall forecast.");
    } finally {
      setIsForecastLoading(false);
    }
  }

  async function manageWater() {
    const pausedAtMs = Date.now();
    const pausedElapsedMs = getElapsedMs(pausedAtMs);
    const pausedHourIndex = Math.min(maxHourIndex, Math.max(0, Math.floor(pausedElapsedMs / HOUR_MS)));
    const pausedState = simulateState(forecast, pausedHourIndex, decisionEvents);

    pauseClock(pausedElapsedMs, pausedAtMs);
    setIsManaging(true);
    setManageError(undefined);
    try {
      const body = {
        currentState: pausedState,
        remainingRainTotal: summarizeForecast(forecast.slice(pausedHourIndex))
      };
      const response = await fetch(apiUrl("/api/manage-water"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, `Manage water failed with HTTP ${response.status}`));
      }

      const data = (await response.json()) as ApiManageWaterResponse;
      if (!isWaterManagementDecision(data.decision)) {
        throw new Error("Manage water response did not include a valid decision.");
      }

      setDecisionEvents((events) => [
        ...events.filter((event) => event.hourIndex !== pausedHourIndex),
        { hourIndex: pausedHourIndex, decision: data.decision }
      ]);
      setLastDecision(data.decision);
      setLastDecisionAt(data.createdAt);
      setIsManaging(false);
      setIsApplyingDecision(true);
      setActiveTransferDecision(data.decision);
      await wait(DECISION_ANIMATION_MS);
      resumeClock(pausedElapsedMs);
    } catch (error) {
      setManageError(error instanceof Error ? error.message : "Could not manage water.");
      resumeClock(pausedElapsedMs);
    } finally {
      setIsManaging(false);
      setIsApplyingDecision(false);
      setActiveTransferDecision(undefined);
    }
  }

  function resetClockToHour(hourIndex: number) {
    setIsSimulationPaused(false);
    setBaseElapsedMs(hourIndex * HOUR_MS);
    setRealStartMs(Date.now());
    setNowMs(Date.now());
  }

  function getElapsedMs(currentTimeMs: number) {
    return baseElapsedMs + (currentTimeMs - realStartMs) * SIMULATION_SPEED;
  }

  function pauseClock(elapsedMs: number, pausedAtMs: number) {
    setBaseElapsedMs(elapsedMs);
    setRealStartMs(pausedAtMs);
    setNowMs(pausedAtMs);
    setIsSimulationPaused(true);
  }

  function resumeClock(elapsedMs: number) {
    const resumedAtMs = Date.now();
    setBaseElapsedMs(elapsedMs);
    setRealStartMs(resumedAtMs);
    setNowMs(resumedAtMs);
    setIsSimulationPaused(false);
  }

  React.useEffect(() => {
    if (hasStartedForecastLoad.current) {
      return;
    }

    hasStartedForecastLoad.current = true;
    initializeForecast();
  }, []);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="app-shell">
      <section className="control-bar">
        <div className="heading-block">
          <div className="heading-row">
            <h1>
              <button
                className={`heading-toggle${isIntroExpanded ? " is-expanded" : ""}`}
                type="button"
                onClick={() => setIsIntroExpanded((isExpanded) => !isExpanded)}
                aria-expanded={isIntroExpanded}
                aria-controls="intro-copy"
                title={isIntroExpanded ? "Hide details" : "Show details"}
              >
                <ChevronRight size={19} aria-hidden="true" />
                <span>Smart Roof Water</span>
              </button>
            </h1>
          </div>
          {isIntroExpanded && (
            <p id="intro-copy" className="intro-copy">
              This is a rainwater manager for a house with a garden.<br />
              Manager waters the garden and decides about tank storage - depending on the weather.<br />
              Principles: <ul>
                <li>Greenroof needs water to cool the building</li>
                <li>Garden is supposed to be maintained above 40% soil humidity</li>
              </ul>
            </p>
          )}
        </div>
        <div className="actions">
          <button
            className="icon-button"
            onClick={manageWater}
            disabled={isManaging || isApplyingDecision || forecast.length === 0}
            title="Ask AI to manage water"
          >
            <Droplet size={18} />
            <span>{isManaging ? "Thinking" : isApplyingDecision ? "Applying" : "Manage water"}</span>
          </button>
        </div>
      </section>

      <section className="dashboard">
        <HouseDiagram
          roofWaterLiters={displayedState.roofWaterLiters}
          gardenTankLiters={displayedState.gardenTankLiters}
          gardenHumidity={displayedState.gardenSoilHumidityPercent}
          isRaining={displayedRain > 0}
          isPaused={isSimulationPaused}
          isThinking={isManaging}
          isApplyingDecision={isApplyingDecision}
        />

        <aside className="metrics-panel">
          <Metric
            label="Roof storage"
            value={displayedState.roofWaterLiters}
            suffix=" L"
            capacity={ROOF_CAPACITY_LITERS}
            tooltip="During dry periods, green roof evaporates water, which cools down the building. Water is taken from roof tank."
            trend={roofStorageTrend}
            animateValue={isApplyingDecision && (activeTransferDecision?.roofToGardenTankLiters ?? 0) > 0}
          />
          <Metric
            label="Garden tank"
            value={displayedState.gardenTankLiters}
            suffix=" L"
            capacity={GARDEN_TANK_CAPACITY_LITERS}
            tooltip="Garden tank can hydrate the garden. It can also store the surplus from the roof"
            trend={gardenTankTrend}
            animateValue={isApplyingDecision && ((activeTransferDecision?.roofToGardenTankLiters ?? 0) > 0 || (activeTransferDecision?.gardenTankToSoilLiters ?? 0) > 0)}
          />
          <Metric
            label="Garden humidity"
            value={displayedState.gardenSoilHumidityPercent}
            suffix="%"
            capacity={100}
            tooltip="Soil dries out steadily when it doesn't rain."
            capacitySuffix="%"
            showCapacity={false}
            trend={gardenHumidityTrend}
            animateValue={isApplyingDecision && (activeTransferDecision?.gardenTankToSoilLiters ?? 0) > 0}
          />
          <div className="decision-block">
            <span>Last AI decision</span>
            {lastDecisionAt && <small>{formatDecisionTimestamp(lastDecisionAt)}</small>}
            <strong>
              {lastDecision
                ? `${lastDecision.roofToGardenTankLiters} L roof to tank / ${lastDecision.gardenTankToSoilLiters} L tank to soil`
                : "Awaiting manage water"}
            </strong>
            <p>{lastDecision?.reasoning ?? "The button sends current tank levels, garden humidity, and the total rainfall expected across all remaining forecast hours."}</p>
            {manageError && <p className="error-text">{manageError}</p>}
          </div>
        </aside>
      </section>

      {forecastError && (
        <section className="status-band" role="alert">
          <strong>Weather fetch failed</strong>
          <p>{forecastError}</p>
        </section>
      )}

      <section className="timeline-band">
        <div className="timeline-header">
          <label htmlFor="timeline">Simulation time</label>
          <span>
            {isForecastLoading
              ? "Awaiting forecast"
              : `${isSimulationPaused ? "Paused" : "Live"} · hour ${displayHourIndex + 1} / ${Math.max(forecast.length, 1)}`}
          </span>
        </div>
        <div className="timeline-track-wrap">
          <input
            id="timeline"
            type="range"
            min={0}
            max={maxHourIndex}
            value={displayHourIndex}
            disabled
            readOnly
          />
        </div>
        {isForecastLoading ? (
          <div className="timeline-loading-state" role="status" aria-live="polite">
            <span className="timeline-spinner" aria-hidden="true" />
            <span>awaiting weather forecast</span>
          </div>
        ) : (
          <div className="forecast-strip">
            {summarizeForecastByDay(forecast).map((day) => (
              <div className="forecast-card" key={day.date}>
                <span className="forecast-card-header">
                  <span>{new Date(day.date).toLocaleDateString(undefined, { weekday: "short" })}</span>
                  {day.rainMm > 0 && <CloudRain size={16} aria-label="Rain expected" />}
                </span>
                <strong>{day.rainMm.toFixed(1)} mm</strong>
                <small className={day.rainMm > 0 ? undefined : "is-empty"} aria-hidden={day.rainMm > 0 ? undefined : true}>
                  {day.rainMm > 0 ? `+${Math.round(day.collectedLiters)} L expected on the roof` : "No rain expected"}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readApiError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.error ?? body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function isWaterManagementDecision(value: unknown): value is WaterManagementDecision {
  if (!value || typeof value !== "object") {
    return false;
  }

  const decision = value as WaterManagementDecision;
  return (
    Number.isFinite(decision.targetRoofLiters) &&
    Number.isFinite(decision.roofToGardenTankLiters) &&
    Number.isFinite(decision.gardenTankToSoilLiters) &&
    typeof decision.reasoning === "string"
  );
}

function simulateState(
  forecast: RainForecastHour[],
  targetHourIndex: number,
  decisionEvents: DecisionEvent[]
): SystemState {
  let state: SystemState = {
    simulationTime: forecast[0]?.time ?? new Date().toISOString(),
    roofWaterLiters: INITIAL_ROOF_LITERS,
    gardenTankLiters: INITIAL_GARDEN_TANK_LITERS,
    gardenSoilHumidityPercent: INITIAL_GARDEN_HUMIDITY_PERCENT
  };

  for (let hourIndex = 0; hourIndex <= targetHourIndex; hourIndex += 1) {
    state = applyDecisionEvents(state, decisionEvents.filter((event) => event.hourIndex === hourIndex));

    if (hourIndex === targetHourIndex) {
      break;
    }

    state = applyWeatherHour(state, forecast[hourIndex], hourIndex);
  }

  return {
    ...state,
    simulationTime: forecast[targetHourIndex]?.time ?? state.simulationTime
  };
}

function applyDecisionEvents(state: SystemState, events: DecisionEvent[]): SystemState {
  return events.filter((event) => isWaterManagementDecision(event.decision)).reduce((nextState, event) => {
    const roofToGardenTankLiters = Math.min(
      event.decision.roofToGardenTankLiters,
      Math.max(0, nextState.roofWaterLiters),
      Math.max(0, GARDEN_TANK_CAPACITY_LITERS - nextState.gardenTankLiters)
    );
    const tankAfterRoofTransfer = nextState.gardenTankLiters + roofToGardenTankLiters;
    const gardenTankToSoilLiters = Math.min(event.decision.gardenTankToSoilLiters, tankAfterRoofTransfer);

    return {
      ...nextState,
      roofWaterLiters: clampLiters(nextState.roofWaterLiters - roofToGardenTankLiters, ROOF_CAPACITY_LITERS),
      gardenTankLiters: clampLiters(tankAfterRoofTransfer - gardenTankToSoilLiters, GARDEN_TANK_CAPACITY_LITERS),
      gardenSoilHumidityPercent: clampPercent(nextState.gardenSoilHumidityPercent + gardenTankToSoilLiters / 100)
    };
  }, state);
}

function applyWeatherHour(state: SystemState, forecastHour: RainForecastHour | undefined, hourIndex: number): SystemState {
  const rainMm = forecastHour?.rainMm ?? 0;
  const humidityChange = rainMm > 0 ? 3 : (hourIndex + 1) % 3 === 0 ? -1 : 0;

  return {
    ...state,
    roofWaterLiters: clampLiters(state.roofWaterLiters + (forecastHour?.collectedLiters ?? 0) - 5, ROOF_CAPACITY_LITERS),
    gardenSoilHumidityPercent: clampPercent(state.gardenSoilHumidityPercent + humidityChange)
  };
}

function HouseDiagram({
  roofWaterLiters,
  gardenTankLiters,
  gardenHumidity,
  isRaining,
  isPaused,
  isThinking,
  isApplyingDecision
}: {
  roofWaterLiters: number;
  gardenTankLiters: number;
  gardenHumidity: number;
  isRaining: boolean;
  isPaused: boolean;
  isThinking: boolean;
  isApplyingDecision: boolean;
}) {
  const gardenSoil = moistureColor(gardenHumidity, "#c68f55", "#466f3d");
  const roofFillPercent = roofWaterLiters / ROOF_CAPACITY_LITERS;
  const roofMoisture = moistureColor(roofFillPercent * 100, "#c68f55", "#466f3d");
  const houseBottomY = 395;
  const houseWidth = 420;
  const houseHeight = 215 * (2 / 3);
  const houseTopY = houseBottomY - houseHeight;
  const roofBaseY = houseTopY;
  const roofOuterHeight = 110 * 1.2;
  const roofApexY = roofBaseY - roofOuterHeight;
  const roofStorageBaseY = roofBaseY - 3;
  const roofStorageHeightMax = 88 * 1.2;
  const roofStorageApexY = roofStorageBaseY - roofStorageHeightMax;
  const roofStorageHeight = roofStorageHeightMax * roofFillPercent;
  const tankOffsetY = 30;
  const tankInnerX = 608;
  const tankInnerBottomY = 368 + tankOffsetY;
  const tankInnerWidth = 52;
  const tankInnerHeight = 128;
  const tankWaterHeight = tankInnerHeight * (gardenTankLiters / GARDEN_TANK_CAPACITY_LITERS);

  return (
    <div className="house-stage" aria-label="Smart house water simulation">
      <svg viewBox="0 0 720 480" role="img">
        <defs>
          <clipPath id="roof-storage-clip">
            <path d={`M137 ${roofStorageBaseY} L360 ${roofStorageApexY} L583 ${roofStorageBaseY} Z`} />
          </clipPath>
          <clipPath id="garden-tank-water-clip">
            <rect x={tankInnerX} y={tankInnerBottomY - tankInnerHeight} width={tankInnerWidth} height={tankInnerHeight} rx="7" />
          </clipPath>
        </defs>
        <rect x="0" y="0" width="720" height="480" fill="#f5f3ec" />
        {isRaining && <RainDrops isPaused={isPaused} />}
        <rect x="0" y="365" width="720" height="115" fill={gardenSoil} />
        <path d={`M88 ${roofBaseY} L360 ${roofApexY} L632 ${roofBaseY} Z`} fill={roofMoisture} />
        <path d={`M137 ${roofStorageBaseY} L360 ${roofStorageApexY} L583 ${roofStorageBaseY} Z`} fill="#ffffff" />
        <rect
          className="roof-storage-fill"
          x="137"
          y={roofStorageBaseY - roofStorageHeight}
          width="446"
          height={roofStorageHeight}
          fill="#4aa3df"
          opacity="0.62"
          clipPath="url(#roof-storage-clip)"
        />
        <rect x="150" y={houseTopY} width={houseWidth} height={houseHeight} fill="#f8faf9" stroke="#1f2933" strokeWidth="7" />
        <DecisionComputer isThinking={isThinking} isApplyingDecision={isApplyingDecision} />
        <rect x="603" y={235 + tankOffsetY} width="62" height="136" rx="10" fill="#d8dee9" stroke="#1f2933" strokeWidth="5" />
        <rect
          className="tank-water-fill"
          x={tankInnerX}
          y={tankInnerBottomY - tankWaterHeight - 2}
          width={tankInnerWidth}
          height={tankWaterHeight}
          fill="#4aa3df"
          opacity="0.85"
          clipPath="url(#garden-tank-water-clip)"
        />
      </svg>
    </div>
  );
}

function DecisionComputer({ isThinking, isApplyingDecision }: { isThinking: boolean; isApplyingDecision: boolean }) {
  const [thinkingCaption, setThinkingCaption] = React.useState("analysing weather");
  const computerScale = 0.5;
  const computerCenterX = 360;
  const computerCenterY = 322;
  const computerLocalCenterX = 280;
  const computerLocalCenterY = 350;
  const computerTransform = `translate(${computerCenterX - computerLocalCenterX * computerScale} ${computerCenterY - computerLocalCenterY * computerScale}) scale(${computerScale})`;
  const caption = isApplyingDecision ? "managing water" : isThinking ? thinkingCaption : undefined;

  React.useEffect(() => {
    if (!isThinking) {
      setThinkingCaption("analysing weather");
      return undefined;
    }

    setThinkingCaption("analysing weather");
    const timer = window.setTimeout(() => setThinkingCaption("calculating water distribution"), 4000);
    return () => window.clearTimeout(timer);
  }, [isThinking]);

  return (
    <g className="decision-computer" aria-label="AI decision computer">
      <g transform={computerTransform}>
        {isThinking && (
          <circle className="decision-computer-loader" cx="280" cy="350" r="74" fill="none" stroke="#97b6d0" strokeWidth="8" strokeLinecap="round" strokeDasharray="96 58" />
        )}
        {isApplyingDecision && <RadioWaveLoader />}
        <rect x="245" y="315" width="70" height="46" rx="6" fill="#1f2933" />
        <rect x="252" y="322" width="56" height="30" rx="4" fill="#b8e6ef" />
        <path d="M274 361 H286 L290 375 H270 Z" fill="#1f2933" />
        <rect x="260" y="374" width="40" height="7" rx="3" fill="#1f2933" />
      </g>
      {caption && (
        <text className="decision-computer-caption" x={computerCenterX} y="381" textAnchor="middle">
          {caption}
        </text>
      )}
    </g>
  );
}

function RadioWaveLoader() {
  return (
    <g className="radio-wave-loader" fill="none" stroke="#6f8fa3" strokeLinecap="round">
      <path className="radio-wave wave-one" d="M318 312 A24 24 0 0 1 328 332" />
      <path className="radio-wave wave-two" d="M329 296 A44 44 0 0 1 348 332" />
      <path className="radio-wave wave-three" d="M341 280 A64 64 0 0 1 368 332" />
    </g>
  );
}

function RainDrops({ isPaused }: { isPaused: boolean }) {
  return (
    <g className={`rain-drops${isPaused ? " paused" : ""}`} stroke="#3b82c4" strokeWidth="5" strokeLinecap="round" opacity="0.8">
      <path d="M145 38 L130 74" />
      <path d="M225 24 L210 60" />
      <path d="M310 42 L295 78" />
      <path d="M405 25 L390 61" />
      <path d="M515 45 L500 81" />
      <path d="M605 30 L590 66" />
    </g>
  );
}

function Metric({
  label,
  value,
  suffix,
  capacity,
  capacitySuffix,
  showCapacity = true,
  trend = "none",
  animateValue = false,
  tooltip
}: {
  label: string;
  value: number;
  suffix: string;
  capacity?: number;
  capacitySuffix?: string;
  showCapacity?: boolean;
  trend?: MetricTrend;
  animateValue?: boolean;
  tooltip?: string;
}) {
  const tooltipId = React.useId();
  const fillPercent = capacity ? Math.min(100, Math.max(0, (value / capacity) * 100)) : undefined;
  const capacityUnit = capacitySuffix ?? suffix;
  const valueClassName = [
    "metric-value-group",
    animateValue ? "is-animating" : "",
    trend !== "none" ? `is-${trend}` : ""
  ].filter(Boolean).join(" ");

  return (
    <div
      className="metric"
      tabIndex={tooltip ? 0 : undefined}
      aria-describedby={tooltip ? tooltipId : undefined}
      style={fillPercent === undefined ? undefined : ({ "--metric-fill": `${fillPercent}%` } as React.CSSProperties)}
    >
      {fillPercent !== undefined && <span className="metric-level-fill" aria-hidden="true" />}
      <span className="metric-label">{label}</span>
      <strong>
        <span className="metric-current">
          <span className={valueClassName}>
            <span className="metric-value" key={animateValue ? `${value}` : "static"}>
              {formatNumber(value)}
            </span>
            <span>{suffix}</span>
          </span>
        </span>
        {capacity && showCapacity && (
          <span className="metric-capacity">
            /{formatNumber(capacity)}
            {capacityUnit}
          </span>
        )}
      </strong>
      {tooltip && (
        <span className="metric-tooltip" id={tooltipId} role="tooltip">
          {tooltip}
        </span>
      )}
    </div>
  );
}

function useMetricTrend(value: number): MetricTrend {
  const previousValueRef = React.useRef(value);
  const [trend, setTrend] = React.useState<MetricTrend>("none");

  React.useEffect(() => {
    const previousValue = previousValueRef.current;
    if (value > previousValue) {
      setTrend("up");
    } else if (value < previousValue) {
      setTrend("down");
    }

    previousValueRef.current = value;
  }, [value]);

  return trend;
}

function summarizeForecastByDay(forecast: RainForecastHour[]) {
  const days = new Map<string, { date: string; rainMm: number; collectedLiters: number }>();
  for (const hour of forecast) {
    const date = hour.time.slice(0, 10);
    const day = days.get(date) ?? { date, rainMm: 0, collectedLiters: 0 };
    day.rainMm += hour.rainMm;
    day.collectedLiters += hour.collectedLiters;
    days.set(date, day);
  }
  return Array.from(days.values()).slice(0, FORECAST_DAYS);
}

function summarizeForecast(forecast: RainForecastHour[]) {
  return forecast.reduce(
    (summary, hour) => ({
      hours: summary.hours + 1,
      rainMm: summary.rainMm + hour.rainMm,
      collectedLiters: summary.collectedLiters + hour.collectedLiters
    }),
    { hours: 0, rainMm: 0, collectedLiters: 0 }
  );
}

function formatDecisionTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function clampLiters(value: number, capacity: number) {
  return Math.min(capacity, Math.max(0, Math.round(value)));
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function moistureColor(value: number, dry: string, wet: string) {
  const amount = Math.min(100, Math.max(0, value)) / 100;
  const dryRgb = hexToRgb(dry);
  const wetRgb = hexToRgb(wet);
  const mixed = dryRgb.map((channel, index) => Math.round(channel + (wetRgb[index] - channel) * amount));
  return `rgb(${mixed.join(",")})`;
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
