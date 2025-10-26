import { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

export const corsMiddleware: MiddlewareHandler = (c, next) => {
  const origin = c.env.CLIENT_STATIC_URL;
  c.set("domain", new URL(origin).hostname);

  return cors({
    origin: origin,
    credentials: true,
  })(c, next);
};
