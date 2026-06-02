import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const currentDir = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(currentDir, "../../.env");

loadEnv({
  path: envPath
});

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function readOpenAiApiKey() {
  const key = readEnv("OPENAI_API_KEY");
  if (!key || key === "sk-your-key") {
    return undefined;
  }

  return key;
}

export function isOpenAiKeyFormatValid(key = config.openAiApiKey) {
  return Boolean(key && key.startsWith("sk-") && key.length > 20);
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  openAiApiKey: readOpenAiApiKey(),
  openAiModel: readEnv("OPENAI_MODEL") ?? "gpt-5-nano",
  openMeteo: {
    latitude: Number(readEnv("OPEN_METEO_LATITUDE") ?? 52.52),
    longitude: Number(readEnv("OPEN_METEO_LONGITUDE") ?? 13.41),
    timezone: readEnv("OPEN_METEO_TIMEZONE") ?? "Europe/Berlin"
  }
};
