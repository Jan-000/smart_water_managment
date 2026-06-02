import type { FastifyInstance } from "fastify";
import type { ApiManageWaterRequest } from "@smart-home/shared";
import { config, isOpenAiKeyFormatValid } from "./config.js";
import { requestWaterManagementDecision } from "./services/openai.js";
import { fetchSevenDayRainForecast, getRoofSurfaceM2 } from "./services/weather.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    ok: true,
    openAi: {
      configured: Boolean(config.openAiApiKey),
      validFormat: isOpenAiKeyFormatValid(),
      model: config.openAiModel
    }
  }));

  app.get("/api/forecast", async () => {
    return {
      fetchedAt: new Date().toISOString(),
      location: config.openMeteo,
      roofSurfaceM2: getRoofSurfaceM2(),
      forecast: await fetchSevenDayRainForecast()
    };
  });

  app.post<{ Body: ApiManageWaterRequest }>("/api/manage-water", async (request) => {
    return {
      createdAt: new Date().toISOString(),
      decision: await requestWaterManagementDecision(request.body)
    };
  });
}
