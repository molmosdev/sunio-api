import { Context, Hono } from "hono";
import { customAlphabet } from "nanoid";
import { getCookie, setCookie } from "hono/cookie";

const nanoid = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  7
);

const app = new Hono();

export interface Event {
  id: string;
  name: string;
  created_at: string;
  last_active: string;
}

export interface Participant {
  id: string;
  event_id: string;
  name: string;
  pin?: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  event_id: string;
  payer_id: string;
  amount: number;
  consumers: string[];
  description?: string | null;
  created_at: string;
}

export interface Balance {
  [participantId: string]: number;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
}

app.get("/recent", async (c: Context) => {
  const supabase = c.get("supabase");
  const cookieName = "recent_events";
  let recentEvents: { id: string; last_active: string }[] = [];
  const cookie = getCookie(c, cookieName);
  if (cookie) {
    try {
      recentEvents = JSON.parse(cookie);
    } catch {}
  }
  if (recentEvents.length === 0) return c.json({ recentEvents: [] });

  // Obtener los nombres de los eventos desde la base de datos
  const ids = recentEvents.map((e) => e.id);
  const { data: eventsData, error } = await supabase
    .from("events")
    .select("id, name")
    .in("id", ids);
  if (error) return c.json({ error: error.message }, 500);

  // Mapear los nombres a los recientes
  const eventsMap = Object.fromEntries(
    (eventsData || []).map((e: { id: any; name: any }) => [e.id, e.name])
  );
  const recentWithNames = recentEvents.map((e) => ({
    id: e.id,
    last_active: e.last_active,
    name: eventsMap[e.id] || null,
  }));
  return c.json({ recentEvents: recentWithNames });
});

app.delete("/recent/:eventId", (c: Context) => {
  const { eventId } = c.req.param();
  const cookieName = "recent_events";
  const maxAge = 60 * 60 * 24 * 90;
  let recentEvents: { id: string; last_active: string }[] = [];
  const cookie = getCookie(c, cookieName);
  if (cookie) {
    try {
      recentEvents = JSON.parse(cookie);
    } catch {}
  }
  recentEvents = recentEvents.filter((e) => e.id !== eventId);
  const domain = c.req.header("host")?.split(":")[0];
  const isLocal = domain === "localhost";
  setCookie(c, cookieName, JSON.stringify(recentEvents), {
    maxAge,
    path: "/",
    httpOnly: false,
    sameSite: "Lax",
    secure: isLocal ? false : true,
  });
  return c.json({ recentEvents });
});

app.get("/recent", async (c: Context) => {
  const supabase = c.get("supabase");
  const cookieName = "recent_events";
  let recentEvents: { id: string; last_active: string }[] = [];
  const cookie = getCookie(c, cookieName);
  if (cookie) {
    try {
      recentEvents = JSON.parse(cookie);
    } catch {}
  }
  if (recentEvents.length === 0) return c.json({ recentEvents: [] });

  // Obtener los nombres de los eventos desde la base de datos
  const ids = recentEvents.map((e) => e.id);
  const { data: eventsData, error } = await supabase
    .from("events")
    .select("id, name");
  if (error) return c.json({ error: error.message }, 500);

  // Mapear los nombres a los recientes con tipado
  type EventRow = { id: string; name: string };
  const eventsMap: Record<string, string> = {};
  (eventsData as EventRow[]).forEach((e) => {
    eventsMap[e.id] = e.name;
  });
  const recentWithNames = recentEvents.map((e) => ({
    id: e.id,
    last_active: e.last_active,
    name: eventsMap[e.id] || null,
  }));
  return c.json({ recentEvents: recentWithNames });
});

app.get("/:eventId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error) return c.json({ error: error.message }, 404);

  const cookieName = "recent_events";
  const maxAge = 60 * 60 * 24 * 90;
  let recentEvents: { id: string; last_active: string }[] = [];
  const cookie = getCookie(c, cookieName);
  if (cookie) {
    try {
      recentEvents = JSON.parse(cookie);
    } catch {}
  }
  recentEvents = recentEvents.filter((e) => e.id !== eventId);
  recentEvents.unshift({ id: eventId, last_active: new Date().toISOString() });
  if (recentEvents.length > 20) recentEvents = recentEvents.slice(0, 20);

  const domain = c.req.header("host")?.split(":")[0];
  const isLocal = domain === "localhost";
  setCookie(c, cookieName, JSON.stringify(recentEvents), {
    maxAge,
    path: "/",
    httpOnly: false,
    sameSite: "Lax",
    secure: isLocal ? false : true,
  });

  console.log(getCookie(c, cookieName));

  return c.json(event as Event);
});

app.put("/:eventId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();
  const { name } = await c.req.json();

  const { data, error } = await supabase
    .from("events")
    .update({ name })
    .eq("id", eventId)
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Event);
});

app.get("/:eventId/participants", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("event_id", eventId);

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Participant[]);
});

app.post("/:eventId/participants", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();
  const { name } = await c.req.json();

  const { data, error } = await supabase
    .from("participants")
    .insert({ event_id: eventId, name })
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Participant);
});

app.put("/:eventId/participants/:participantId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, participantId } = c.req.param();
  const { name } = await c.req.json();

  const { data, error } = await supabase
    .from("participants")
    .update({ name })
    .eq("id", participantId)
    .eq("event_id", eventId)
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Participant);
});

app.post("/:eventId/participants/:participantId/pin", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, participantId } = c.req.param();
  const { pin } = await c.req.json();

  const { data, error } = await supabase
    .from("participants")
    .update({ pin })
    .eq("id", participantId)
    .eq("event_id", eventId)
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Participant);
});

app.post("/:eventId/participants/:participantId/login", async (c: Context) => {
  const supabase = c.get("supabase");
  const { participantId } = c.req.param();
  const { pin } = await c.req.json();

  const { data: participant, error } = await supabase
    .from("participants")
    .select("*")
    .eq("id", participantId)
    .single();

  if (error || !participant)
    return c.json({ error: "Participante no encontrado" }, 404);

  const typedParticipant = participant as Participant;

  if (typedParticipant.pin !== pin)
    return c.json({ error: "PIN incorrecto" }, 401);

  return c.json({ success: true, participantId: typedParticipant.id });
});

app.delete("/:eventId/participants/:participantId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, participantId } = c.req.param();

  const { error } = await supabase
    .from("participants")
    .delete()
    .eq("id", participantId)
    .eq("event_id", eventId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

app.get("/:eventId/expenses", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("event_id", eventId);

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Expense[]);
});

app.post("/:eventId/expenses", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();
  const { payer_id, amount, consumers, description } = await c.req.json();

  const { data, error } = await supabase
    .from("expenses")
    .insert({ event_id: eventId, payer_id, amount, consumers, description })
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Expense);
});

app.put("/:eventId/expenses/:expenseId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, expenseId } = c.req.param();
  const { payer_id, amount, consumers, description } = await c.req.json();

  const { data, error } = await supabase
    .from("expenses")
    .update({ payer_id, amount, consumers, description })
    .eq("id", expenseId)
    .eq("event_id", eventId)
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Expense);
});

app.delete("/:eventId/expenses/:expenseId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, expenseId } = c.req.param();

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("event_id", eventId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

app.get("/:eventId/balances", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data: expenses } = await supabase
    .from("expenses")
    .select("*")
    .eq("event_id", eventId);

  const { data: participants } = await supabase
    .from("participants")
    .select("*")
    .eq("event_id", eventId);

  const balances: Record<string, number> = {};
  participants?.forEach((p: Participant) => (balances[p.id] = 0));

  expenses?.forEach((e: Expense) => {
    const split = e.amount / e.consumers.length;
    e.consumers.forEach((cId: string) => {
      balances[cId] -= split;
    });
    balances[e.payer_id] += e.amount;
  });

  return c.json({ balances });
});

app.post("/:eventId/settle", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data: expenses, error: expensesError } = await supabase
    .from("expenses")
    .select("*")
    .eq("event_id", eventId);

  if (expensesError) return c.json({ error: expensesError.message }, 500);

  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select("*")
    .eq("event_id", eventId);

  if (participantsError)
    return c.json({ error: participantsError.message }, 500);

  const balances: Record<string, number> = {};
  participants?.forEach((p: Participant) => (balances[p.id] = 0));

  expenses?.forEach((e: Expense) => {
    const split = e.amount / e.consumers.length;
    e.consumers.forEach((cId: string) => {
      balances[cId] -= split;
    });
    balances[e.payer_id] += e.amount;
  });

  const settlements: Settlement[] = [];
  const positive = Object.entries(balances).filter(([_, v]) => v > 0);
  const negative = Object.entries(balances).filter(([_, v]) => v < 0);

  let i = 0,
    j = 0;
  while (i < positive.length && j < negative.length) {
    const [posId, posAmount] = positive[i];
    const [negId, negAmount] = negative[j];
    const amt = Math.min(posAmount, -negAmount);
    settlements.push({
      from: negId,
      to: posId,
      amount: Math.round(amt * 100) / 100,
    });

    positive[i][1] -= amt;
    negative[j][1] += amt;

    if (Math.abs(positive[i][1]) < 0.01) i++;
    if (Math.abs(negative[j][1]) < 0.01) j++;
  }

  return c.json({ balances, settlements });
});

app.delete("/cleanup", async (c: Context) => {
  const supabase = c.get("supabase");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const { error } = await supabase
    .from("events")
    .delete()
    .lt("last_active", cutoff.toISOString());

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

export default app;
