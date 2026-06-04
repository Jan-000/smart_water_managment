import axios from "axios";
import type { RainForecastHour } from "@smart-home/shared";
import { config } from "../config.js";

const ROOF_SURFACE_M2 = 100;
const FORECAST_DAYS = 7;
const HOURS_PER_DAY = 24;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const OPEN_METEO_REQUEST_TIMEOUT_MS = 8000;
const HOURLY_RAIN_FIELDS = ["rain", "precipitation"].join(",");

type OpenMeteoHourlyResponse = {
  hourly: {
    time: string[];
    rain?: number[];
    precipitation?: number[];
  };
};

export function getRoofSurfaceM2() {
  return ROOF_SURFACE_M2;
}

export async function fetchSevenDayRainForecast(): Promise<RainForecastHour[]> {
  try {
    const response = await requestOpenMeteoForecast();
    return mapOpenMeteoRainForecast(response.data);
  } catch (error) {
    console.warn("[weather] Open-Meteo forecast unavailable. Falling back to historical archive.", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const response = await requestOpenMeteoArchive();
  return mapOpenMeteoRainForecast(response.data);
}

function mapOpenMeteoRainForecast(data: OpenMeteoHourlyResponse): RainForecastHour[] {
  const rain = data.hourly.rain ?? data.hourly.precipitation ?? [];

  return data.hourly.time.slice(0, FORECAST_DAYS * HOURS_PER_DAY).map((time, index) => ({
    time,
    rainMm: Number((rain[index] ?? 0).toFixed(1)),
    collectedLiters: Math.round((rain[index] ?? 0) * ROOF_SURFACE_M2)
  }));
}

function requestOpenMeteoForecast() {
  console.log("[weather] Requesting current Open-Meteo forecast.", {
    forecastDays: FORECAST_DAYS
  });

  return axios.get<OpenMeteoHourlyResponse>(OPEN_METEO_FORECAST_URL, {
    timeout: OPEN_METEO_REQUEST_TIMEOUT_MS,
    params: {
      latitude: config.openMeteo.latitude,
      longitude: config.openMeteo.longitude,
      timezone: config.openMeteo.timezone,
      forecast_days: FORECAST_DAYS,
      hourly: HOURLY_RAIN_FIELDS
    }
  });
}

function requestOpenMeteoArchive() {
  const today = new Date();
  const endDate = formatDate(new Date(today.getTime() - DAY_MS));
  const startDate = formatDate(new Date(today.getTime() - FORECAST_DAYS * DAY_MS));

  console.log("[weather] Requesting historical Open-Meteo archive.", {
    startDate,
    endDate
  });

  return axios.get<OpenMeteoHourlyResponse>(OPEN_METEO_ARCHIVE_URL, {
    timeout: OPEN_METEO_REQUEST_TIMEOUT_MS,
    params: {
      latitude: config.openMeteo.latitude,
      longitude: config.openMeteo.longitude,
      timezone: config.openMeteo.timezone,
      start_date: startDate,
      end_date: endDate,
      hourly: HOURLY_RAIN_FIELDS
    }
  });
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
