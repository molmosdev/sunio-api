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
  is_admin?: boolean;
  pin_reset_requested?: boolean;
}

export interface Expense {
  id: string;
  event_id: string;
  payer_id: string;
  amount: number;
  consumers: string[];
  description?: string | null;
  created_at: string;
  updated_by: string;
}

export interface Balance {
  [participantId: string]: number;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
  payment_id?: string;
}

export interface Payment {
  id: string;
  event_id: string;
  from_participant: string;
  to_participant: string;
  amount: number;
  created_at: string;
}

// Events

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

  const ids = recentEvents.map((e) => e.id);
  const { data: eventsData, error } = await supabase
    .from("events")
    .select("id, name")
    .in("id", ids);
  if (error) return c.json({ error: error.message }, 500);

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

app.post("/", async (c: Context) => {
  const supabase = c.get("supabase");
  const { name } = await c.req.json();
  const eventId = nanoid();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({ id: eventId, name })
    .select("*")
    .single();
  if (eventError) return c.json({ error: eventError.message }, 500);
  return c.json({ eventId: event.id });
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
  let recentEvents: { id: string; last_active: string; name: string | null }[] =
    [];
  const cookie = getCookie(c, cookieName);
  if (cookie) {
    try {
      recentEvents = JSON.parse(cookie);
    } catch {}
  }
  recentEvents = recentEvents.filter((e) => e.id !== eventId);
  recentEvents.unshift({
    id: eventId,
    last_active: new Date().toISOString(),
    name: event.name || null,
  });
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

// Participants

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
  const { name, pin } = await c.req.json();

  if (!name || !pin) {
    return c.json({ error: "El nombre y el PIN son obligatorios" }, 400);
  }

  const { data: existing, error: existingError } = await supabase
    .from("participants")
    .select("id")
    .eq("event_id", eventId)
    .eq("name", name);
  if (existingError) return c.json({ error: existingError.message }, 500);
  if (existing && existing.length > 0) {
    return c.json(
      { error: "Ya existe un participante con ese nombre en el evento" },
      409
    );
  }

  const { count } = await supabase
    .from("participants")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  const isAdmin = count === 0;

  const { data, error } = await supabase
    .from("participants")
    .insert({ event_id: eventId, name, pin, is_admin: isAdmin })
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

  return c.json({ success: true, participant: typedParticipant });
});

app.post(
  "/:eventId/participants/:participantId/request-pin-reset",
  async (c: Context) => {
    const supabase = c.get("supabase");
    const { eventId, participantId } = c.req.param();

    const { data, error } = await supabase
      .from("participants")
      .update({ pin_reset_requested: true })
      .eq("id", participantId)
      .eq("event_id", eventId)
      .select("*")
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data as Participant);
  }
);

app.post(
  "/:eventId/participants/:participantId/reset-pin",
  async (c: Context) => {
    const supabase = c.get("supabase");
    const { eventId, participantId } = c.req.param();
    const { requesterId } = await c.req.json();

    const { data: requester, error: requesterError } = await supabase
      .from("participants")
      .select("is_admin")
      .eq("id", requesterId)
      .eq("event_id", eventId)
      .single();
    if (requesterError || !requester?.is_admin) {
      return c.json({ error: "Solo un admin puede resetear el PIN" }, 403);
    }

    const { data, error } = await supabase
      .from("participants")
      .update({ pin: null, pin_reset_requested: false })
      .eq("id", participantId)
      .eq("event_id", eventId)
      .select("*")
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data as Participant);
  }
);

app.post(
  "/:eventId/participants/:participantId/promote",
  async (c: Context) => {
    const supabase = c.get("supabase");
    const { eventId, participantId } = c.req.param();
    const { requesterId } = await c.req.json();

    const { data: requester, error: requesterError } = await supabase
      .from("participants")
      .select("is_admin")
      .eq("id", requesterId)
      .eq("event_id", eventId)
      .single();
    if (requesterError || !requester?.is_admin) {
      return c.json(
        { error: "Solo un admin puede promover a otro participante" },
        403
      );
    }

    const { data, error } = await supabase
      .from("participants")
      .update({ is_admin: true })
      .eq("id", participantId)
      .eq("event_id", eventId)
      .select("*")
      .single();
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data as Participant);
  }
);

app.post("/:eventId/participants/:participantId/demote", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, participantId } = c.req.param();
  const { requesterId } = await c.req.json();

  const { data: requester, error: requesterError } = await supabase
    .from("participants")
    .select("is_admin")
    .eq("id", requesterId)
    .eq("event_id", eventId)
    .single();
  if (requesterError || !requester?.is_admin) {
    return c.json({ error: "Solo un admin puede quitar el rol de admin" }, 403);
  }

  if (requesterId === participantId) {
    const { count } = await supabase
      .from("participants")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("is_admin", true);
    if (count === 1) {
      return c.json(
        { error: "No puedes quitarte el rol de admin si eres el único admin" },
        400
      );
    }
  }

  const { data, error } = await supabase
    .from("participants")
    .update({ is_admin: false })
    .eq("id", participantId)
    .eq("event_id", eventId)
    .select("*")
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data as Participant);
});

app.get("/:eventId/admins", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("event_id", eventId)
    .eq("is_admin", true);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data as Participant[]);
});

// Expenses

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
  const { payer_id, amount, consumers, description, updated_by } =
    await c.req.json();

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      event_id: eventId,
      payer_id,
      amount,
      consumers,
      description,
      updated_by,
    })
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);

  return c.json(data as Expense);
});

app.put("/:eventId/expenses/:expenseId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, expenseId } = c.req.param();
  const { payer_id, amount, consumers, description, updated_by } =
    await c.req.json();

  const { data, error } = await supabase
    .from("expenses")
    .update({ payer_id, amount, consumers, description, updated_by })
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

// Payments

app.get("/:eventId/payments", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("event_id", eventId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data as Payment[]);
});

app.post("/:eventId/payments", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();
  const { from_participant, to_participant, amount } = await c.req.json();

  if (!from_participant || !to_participant || !amount) {
    return c.json({ error: "Faltan datos obligatorios" }, 400);
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({ event_id: eventId, from_participant, to_participant, amount })
    .select("*")
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(data as Payment);
});

app.delete("/:eventId/payments/:paymentId", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId, paymentId } = c.req.param();

  const { error } = await supabase
    .from("payments")
    .delete()
    .eq("id", paymentId)
    .eq("event_id", eventId);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true });
});

// Balances

app.get("/:eventId/balances", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const [{ data: expenses }, { data: participants }, { data: payments }] =
    await Promise.all([
      supabase.from("expenses").select("*").eq("event_id", eventId),
      supabase.from("participants").select("*").eq("event_id", eventId),
      supabase.from("payments").select("*").eq("event_id", eventId),
    ]);

  const balances: Record<string, number> = {};
  participants?.forEach((p: Participant) => (balances[p.id] = 0));

  // 1. Aplica los gastos con reparto preciso
  expenses?.forEach((e: Expense) => {
    const splits = splitAmountPrecisely(e.amount, e.consumers.length);
    e.consumers.forEach((cId: string, idx: number) => {
      balances[cId] -= splits[idx];
    });
    balances[e.payer_id] += e.amount;
  });

  // 2. Aplica los pagos
  payments?.forEach((p: Payment) => {
    balances[p.from_participant] += Number(p.amount);
    balances[p.to_participant] -= Number(p.amount);
  });

  return c.json({ balances });
});

// Settlements

app.get("/:eventId/settlements", async (c: Context) => {
  const supabase = c.get("supabase");
  const { eventId } = c.req.param();

  const [
    { data: expenses, error: expensesError },
    { data: participants, error: participantsError },
    { data: payments, error: paymentsError },
  ] = await Promise.all([
    supabase.from("expenses").select("*").eq("event_id", eventId),
    supabase.from("participants").select("*").eq("event_id", eventId),
    supabase.from("payments").select("*").eq("event_id", eventId),
  ]);

  if (expensesError) return c.json({ error: expensesError.message }, 500);
  if (participantsError)
    return c.json({ error: participantsError.message }, 500);
  if (paymentsError) return c.json({ error: paymentsError.message }, 500);

  const settlements: Settlement[] = [];

  // 1. Añade todos los pagos como settlements históricos
  payments?.forEach((p: Payment) => {
    settlements.push({
      from: p.from_participant,
      to: p.to_participant,
      amount: Number(p.amount),
      payment_id: p.id,
    });
  });

  // 2. Calcula balances FINALES (gastos + pagos)
  const balances: Record<string, number> = {};
  participants?.forEach((p: Participant) => (balances[p.id] = 0));

  expenses?.forEach((e: Expense) => {
    const splits = splitAmountPrecisely(e.amount, e.consumers.length);
    e.consumers.forEach((cId: string, idx: number) => {
      balances[cId] -= splits[idx];
    });
    balances[e.payer_id] += e.amount;
  });

  payments?.forEach((p: Payment) => {
    balances[p.from_participant] += Number(p.amount);
    balances[p.to_participant] -= Number(p.amount);
  });

  // 3. Calcula liquidaciones PENDIENTES óptimas a partir de los balances finales
  const positive = Object.entries(balances)
    .filter(([_, v]) => v > 0.01)
    .map(([id, amt]) => ({ id, amt }));
  const negative = Object.entries(balances)
    .filter(([_, v]) => v < -0.01)
    .map(([id, amt]) => ({ id, amt: -amt }));

  let i = 0,
    j = 0;
  while (i < positive.length && j < negative.length) {
    const amt = Math.min(positive[i].amt, negative[j].amt);

    if (amt > 0.01) {
      settlements.push({
        from: negative[j].id,
        to: positive[i].id,
        amount: Math.round(amt * 100) / 100,
      });
    }

    positive[i].amt -= amt;
    negative[j].amt -= amt;

    if (positive[i].amt < 0.01) i++;
    if (negative[j].amt < 0.01) j++;
  }

  return c.json({ settlements });
});

function splitAmountPrecisely(total: number, n: number): number[] {
  const exact = total / n;
  const floored = Math.floor(exact * 100) / 100;
  const result = Array(n).fill(floored);
  let sum = floored * n;
  let diff = Math.round((total - sum) * 100);

  for (let i = 0; diff > 0; i++, diff--) {
    result[i] = Math.round((result[i] + 0.01) * 100) / 100;
  }
  return result;
}

export default app;
