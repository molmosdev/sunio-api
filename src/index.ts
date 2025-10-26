import { Hono } from "hono";
import { supabaseMiddleware } from "./middlewares/supabase.middleware";
import events from "./routes/events.route";
import { corsMiddleware } from "./middlewares/cors.middleware";

type Bindings = {
  CLIENT_STATIC_URL: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware
app.use("*", corsMiddleware);

// Supabase middleware
app.use("*", supabaseMiddleware);

// Routes
app.route("/events", events);

export default app;
