import { MiddlewareHandler } from "hono";
import { createServerClient } from "@supabase/ssr";
import { setCookie } from "hono/cookie";

export const supabaseMiddleware: MiddlewareHandler = async (c, next) => {
  const domain = c.get("domain");
  const isLocal = domain === "localhost";

  const supabase = createServerClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY, {
    cookies: {
      getAll: () => {
        const cookieHeader = c.req.header("Cookie") || "";
        return cookieHeader.split(";").map((cookie) => {
          const [name, ...rest] = cookie.trim().split("=");
          return { name, value: rest.join("=") };
        });
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          /* @ts-ignore */
          setCookie(c, name, value, {
            ...options,
            httpOnly: true,
            secure: isLocal ? false : true,
            sameSite: "Lax",
            path: "/",
          })
        );
      },
    },
    auth: {
      flowType: "pkce",
    },
  });

  c.set("supabase", supabase);
  await next();
};
