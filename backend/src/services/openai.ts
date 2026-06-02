import axios from "axios";
import type { ApiManageWaterRequest, WaterManagementDecision } from "@smart-home/shared";
import { config, isOpenAiKeyFormatValid } from "../config.js";

const ROOF_CAPACITY_LITERS = 5000;
const GARDEN_TANK_CAPACITY_LITERS = 5000;
const MIN_ROOF_LITERS = 500;
const MIN_GARDEN_HUMIDITY_PERCENT = 40;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

function extractResponseText(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const response = data as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
      }>;
    }>;
  };

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text)
    .find((text): text is string => typeof text === "string" && text.length > 0);
}

export async function requestWaterManagementDecision(input: ApiManageWaterRequest): Promise<WaterManagementDecision> {
  console.log("[manage-water:openai] Starting OpenAI water-management request.");
  const fallback = fallbackDecision(input);

  if (!isOpenAiKeyFormatValid()) {
    console.log("[manage-water:openai] OPENAI_API_KEY is missing or has invalid local format. Returning fallback.");
    return fallback;
  }
  const promptInput = summarizePromptInput(input);
  const payload = {
    model: config.openAiModel,
    instructions:
      "You manage a green-roof water system. Return only valid JSON with integer fields targetRoofLiters, roofToGardenTankLiters, gardenTankToSoilLiters and a very short reasoning string. Do not wrap the JSON in markdown. Keep garden soil at least the stated minimum humidity, taking into account rain and no-rain to come. So sometimes give more water to garden. roofToGardenTankLiters is a transfer performed right now from current roof water only. targetRoofLiters must equal current roof water minus roofToGardenTankLiters. Release water from roof to tank, and or to ground from the tank, if rain is anticipated. Reason very quickly, that is more important than accurate answer.",
    input:
      `Roof ${promptInput.roofWaterLiters}/${ROOF_CAPACITY_LITERS} L, garden tank ${promptInput.gardenTankLiters}/${GARDEN_TANK_CAPACITY_LITERS} L, soil ${promptInput.gardenSoilHumidityPercent}%, should be noticably higher than ${MIN_GARDEN_HUMIDITY_PERCENT}%. ` +
      `Remaining rain total across the next ${promptInput.expectedHours} forecast hours: ${promptInput.expectedRainMm} mm (${promptInput.expectedCollectedLiters} L roof collection). ` +
      `Keep roof >= ${MIN_ROOF_LITERS} L. 100 L from tank to soil raises soil humidity 1%.`
  };

  console.log("[manage-water:openai] Sending request to OpenAI.", {
    url: OPENAI_RESPONSES_URL,
    model: payload.model,
    requestShape: "POST /v1/responses { model, instructions, input }",
    promptInput
  });

  try {
    const response = await axios.post(OPENAI_RESPONSES_URL, payload, {
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        "Content-Type": "application/json"
      }
    });

    console.log("[manage-water:openai] OpenAI responded.", {
      status: response.status,
      responseId: response.data.id,
      statusField: response.data.status,
      outputItemCount: response.data.output?.length ?? 0
    });

    const content = extractResponseText(response.data);
    if (!content) {
      console.log("[manage-water:openai] Response was successful but no output text was found.", response.data);
      throw new Error("OpenAI response did not include output text.");
    }

    console.log("[manage-water:openai] Parsed assistant output text.", { content });

    const parsed = parseWaterManagementDecision(content);
    const decision = normalizeDecision(parsed, input);
    console.log("[manage-water:openai] Normalized OpenAI decision.", decision);

    return decision;
  } catch (error) {
    console.log("[manage-water:openai] Returning fallback decision.", {
      reason: openAiFallbackReason(error)
    });

    return {
      ...fallback,
      reasoning: `${fallback.reasoning} ${openAiFallbackReason(error)}`
    };
  }
}

function parseWaterManagementDecision(content: string): WaterManagementDecision {
  const jsonText = content.trim().startsWith("{") ? content.trim() : extractFirstJsonObject(content);
  const parsed = JSON.parse(jsonText) as Partial<WaterManagementDecision>;

  if (
    typeof parsed.targetRoofLiters !== "number" ||
    typeof parsed.roofToGardenTankLiters !== "number" ||
    typeof parsed.gardenTankToSoilLiters !== "number"
  ) {
    throw new Error("OpenAI response JSON did not include the required numeric decision fields.");
  }

  return {
    targetRoofLiters: parsed.targetRoofLiters,
    roofToGardenTankLiters: parsed.roofToGardenTankLiters,
    gardenTankToSoilLiters: parsed.gardenTankToSoilLiters,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning returned."
  };
}

function extractFirstJsonObject(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("OpenAI response did not contain a JSON object.");
  }

  return content.slice(start, end + 1);
}

function summarizePromptInput(input: ApiManageWaterRequest) {
  return {
    roofWaterLiters: Math.round(input.currentState.roofWaterLiters),
    gardenTankLiters: Math.round(input.currentState.gardenTankLiters),
    gardenSoilHumidityPercent: Math.round(input.currentState.gardenSoilHumidityPercent),
    expectedHours: Math.round(input.remainingRainTotal.hours),
    expectedRainMm: Number(input.remainingRainTotal.rainMm.toFixed(1)),
    expectedCollectedLiters: Math.round(input.remainingRainTotal.collectedLiters)
  };
}

function fallbackDecision(input: ApiManageWaterRequest): WaterManagementDecision {
  const { currentState, remainingRainTotal } = input;
  const projectedRainLiters = remainingRainTotal.collectedLiters;
  const projectedEvaporationLiters = remainingRainTotal.hours;
  const projectedRoofLiters = currentState.roofWaterLiters + projectedRainLiters - projectedEvaporationLiters;
  const soilNeedLiters = gardenSoilNeedLiters(currentState.gardenSoilHumidityPercent);
  const tankAfterSoil = Math.max(0, currentState.gardenTankLiters - soilNeedLiters);
  const tankSpaceLiters = GARDEN_TANK_CAPACITY_LITERS - tankAfterSoil;
  const overflowRiskLiters = Math.max(0, projectedRoofLiters - ROOF_CAPACITY_LITERS);
  const roofCanReleaseLiters = Math.max(0, currentState.roofWaterLiters - MIN_ROOF_LITERS);
  const roofToGardenTankLiters = Math.round(Math.min(roofCanReleaseLiters, tankSpaceLiters, overflowRiskLiters));
  const gardenTankToSoilLiters = Math.round(Math.min(currentState.gardenTankLiters + roofToGardenTankLiters, soilNeedLiters));

  return {
    targetRoofLiters: Math.round(currentState.roofWaterLiters - roofToGardenTankLiters),
    roofToGardenTankLiters,
    gardenTankToSoilLiters,
    reasoning:
      "Fallback rule: reduce forecast overflow risk, preserve at least 500 L on the roof, and irrigate only enough to keep garden soil at least 40%."
  };
}

function normalizeDecision(
  decision: WaterManagementDecision,
  input: ApiManageWaterRequest
): WaterManagementDecision {
  const currentRoof = input.currentState.roofWaterLiters;
  const currentTank = input.currentState.gardenTankLiters;
  const soilNeedLiters = gardenSoilNeedLiters(input.currentState.gardenSoilHumidityPercent);
  const roofToGardenTankLiters = clampLiters(
    decision.roofToGardenTankLiters,
    0,
    Math.min(Math.max(0, currentRoof - MIN_ROOF_LITERS), Math.max(0, GARDEN_TANK_CAPACITY_LITERS - currentTank))
  );
  const gardenTankToSoilLiters = clampLiters(
    decision.gardenTankToSoilLiters,
    0,
    Math.min(currentTank + roofToGardenTankLiters, soilNeedLiters)
  );

  return {
    targetRoofLiters: clampLiters(currentRoof - roofToGardenTankLiters, MIN_ROOF_LITERS, ROOF_CAPACITY_LITERS),
    roofToGardenTankLiters,
    gardenTankToSoilLiters,
    reasoning: decision.reasoning || "No reasoning returned."
  };
}

function gardenSoilNeedLiters(currentHumidityPercent: number) {
  return Math.max(0, MIN_GARDEN_HUMIDITY_PERCENT - currentHumidityPercent) * 100;
}

function clampLiters(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
}

function openAiFallbackReason(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) {
      return "OpenAI rate limits or quota blocked this request, so local fallback rules were used.";
    }

    return `OpenAI returned HTTP ${error.response?.status ?? "error"}, so local fallback rules were used.`;
  }

  if (error instanceof SyntaxError) {
    return "OpenAI returned text that could not be parsed as JSON, so local fallback rules were used.";
  }

  if (error instanceof Error && error.message.includes("OpenAI response")) {
    return `${error.message} Local fallback rules were used.`;
  }

  return "OpenAI was unavailable, so local fallback rules were used.";
}
