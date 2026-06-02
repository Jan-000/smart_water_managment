export type RainForecastHour = {
  time: string;
  rainMm: number;
  collectedLiters: number;
};

export type RainForecastSummary = {
  hours: number;
  rainMm: number;
  collectedLiters: number;
};

export type SystemState = {
  simulationTime: string;
  roofWaterLiters: number;
  gardenTankLiters: number;
  gardenSoilHumidityPercent: number;
};

export type WaterManagementDecision = {
  targetRoofLiters: number;
  roofToGardenTankLiters: number;
  gardenTankToSoilLiters: number;
  reasoning: string;
};

export type ApiForecastResponse = {
  fetchedAt: string;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  roofSurfaceM2: number;
  forecast: RainForecastHour[];
};

export type ApiManageWaterRequest = {
  currentState: SystemState;
  remainingRainTotal: RainForecastSummary;
};

export type ApiManageWaterResponse = {
  createdAt: string;
  decision: WaterManagementDecision;
};
