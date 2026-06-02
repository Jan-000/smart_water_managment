import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

await registerRoutes(app);

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
