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

app.post("/", async (c: Context) => {
  const supabase = c.get("supabase");

  const { name, participants } = await c.req.json();

  const eventId = nanoid();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({ id: eventId, name })
    .select("*")
    .single();

  if (eventError) return c.json({ error: eventError.message }, 500);

  if (participants?.length) {
    const participantsData = participants.map((p: string) => ({
      event_id: event.id,
      name: p,
    }));
    const { error: participantsError } = await supabase
      .from("participants")
      .insert(participantsData);

    if (participantsError)
      return c.json({ error: participantsError.message }, 500);
  }

  return c.json({ eventId: event.id });
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
  const cookieName = "recent_events";
  let recentEvents: { id: string; last_active: string; name: string | null }[] =
    [];
  const cookie = getCookie(c, cookieName);
  if (cookie) {
    try {
      recentEvents = JSON.parse(cookie);
    } catch {}
  }
  return c.json({ recentEvents });
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

  const [{ data: expenses }, { data: participants }, { data: payments }] =
    await Promise.all([
      supabase.from("expenses").select("*").eq("event_id", eventId),
      supabase.from("participants").select("*").eq("event_id", eventId),
      supabase.from("payments").select("*").eq("event_id", eventId),
    ]);

  const balances: Record<string, number> = {};
  participants?.forEach((p: Participant) => (balances[p.id] = 0));

  // 1. Aplica los gastos
  expenses?.forEach((e: Expense) => {
    const split = e.amount / e.consumers.length;
    e.consumers.forEach((cId: string) => {
      balances[cId] -= split;
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

  // 1. Calcula balances SOLO con los gastos
  const balances: Record<string, number> = {};
  participants?.forEach((p: Participant) => (balances[p.id] = 0));

  expenses?.forEach((e: Expense) => {
    const split = e.amount / e.consumers.length;
    e.consumers.forEach((cId: string) => {
      balances[cId] -= split;
    });
    balances[e.payer_id] += e.amount;
  });

  // 2. Calcula settlements ORIGINALES (sin pagos)
  const originalSettlements: { from: string; to: string; amount: number }[] =
    [];
  const positive = Object.entries(balances).filter(([_, v]) => v > 0);
  const negative = Object.entries(balances).filter(([_, v]) => v < 0);

  let i = 0,
    j = 0;
  while (i < positive.length && j < negative.length) {
    const [posId, posAmount] = positive[i];
    const [negId, negAmount] = negative[j];
    const amt = Math.min(posAmount, -negAmount);

    originalSettlements.push({
      from: negId,
      to: posId,
      amount: Math.round(amt * 100) / 100,
    });

    positive[i][1] -= amt;
    negative[j][1] += amt;

    if (Math.abs(positive[i][1]) < 0.01) i++;
    if (Math.abs(negative[j][1]) < 0.01) j++;
  }

  // 3. Para cada settlement original, busca pagos asociados y separa pagos exactos y pendientes
  const settlements: Settlement[] = [];

  for (const s of originalSettlements) {
    // Busca todos los pagos entre from y to
    const relatedPayments =
      payments?.filter(
        (p: Payment) =>
          p.from_participant === s.from && p.to_participant === s.to
      ) || [];

    let remaining = s.amount;

    // Para cada pago, crea un settlement pagado
    for (const p of relatedPayments) {
      const paidAmount = Math.min(remaining, Number(p.amount));
      if (paidAmount > 0) {
        settlements.push({
          from: s.from,
          to: s.to,
          amount: Math.round(paidAmount * 100) / 100,
          payment_id: p.id,
        });
        remaining -= paidAmount;
      }
    }

    // Si queda algo pendiente, crea un settlement sin payment_id
    if (remaining > 0.01) {
      settlements.push({
        from: s.from,
        to: s.to,
        amount: Math.round(remaining * 100) / 100,
      });
    }
  }

  return c.json({ settlements });
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
