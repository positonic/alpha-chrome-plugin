# Backend Spec: Extension Token Exchange Endpoint

The Chrome extension now supports auto-authentication by reading the user's
NextAuth session cookie and exchanging it for a JWT. Two backend changes are
needed on the Exponential app.

---

## 1. New endpoint: `POST /api/auth/extension-token`

**File:** `src/app/api/auth/extension-token/route.ts`

### Request

```
POST /api/auth/extension-token
Headers:
  Content-Type: application/json
  x-session-token: <encrypted NextAuth cookie value>
```

The `x-session-token` value is the raw value of the `authjs.session-token`
(or `__Secure-authjs.session-token`) cookie, read by the Chrome extension via
`chrome.cookies.get()`.

### Implementation

```typescript
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { db } from "~/server/db";
import { generateJWT } from "~/server/utils/jwt";

export async function POST(request: Request) {
  try {
    const sessionToken = request.headers.get("x-session-token");
    if (!sessionToken) {
      return NextResponse.json({ error: "Missing x-session-token header" }, { status: 400 });
    }

    // Decode the encrypted NextAuth session cookie
    const decoded = await decode({
      token: sessionToken,
      secret: process.env.AUTH_SECRET!,
    });

    if (!decoded?.sub) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    // Look up the user
    const user = await db.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true, email: true, name: true, image: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 401 });
    }

    // Generate a scoped JWT (7-day expiry)
    const expiryMinutes = 60 * 24 * 7; // 7 days
    const jwt = generateJWT(user, {
      tokenType: "api-token",
      expiryMinutes,
    });

    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;

    return NextResponse.json({ jwt, expiresAt });
  } catch (error) {
    console.error("Extension token exchange error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

### Response (200)

```json
{
  "jwt": "<signed-jwt-string>",
  "expiresAt": 1740105600000
}
```

### Response (401)

```json
{ "error": "Invalid or expired session" }
```

---

## 2. Router middleware update (required)

The extension sends the JWT via `Authorization: Bearer <jwt>`. The tRPC
context in `src/server/api/trpc.ts` already validates Bearer tokens and
creates a session. However, the `apiKeyMiddleware` in the individual routers
only checks `x-api-key` against the `VerificationToken` table.

Add a session fallthrough at the top of each `apiKeyMiddleware`:

```typescript
const apiKeyMiddleware = publicProcedure.use(async ({ ctx, next }) => {
  // If already authenticated via Bearer token or session cookie
  if (ctx.session?.user) {
    return next({ ctx: { userId: ctx.session.user.id } });
  }

  // Existing x-api-key validation (unchanged)...
  const apiKey = ctx.headers.get("x-api-key");
  // ...
});
```

### Files to update

- `src/server/api/routers/transcription.ts` (used by startSession, saveTranscription, saveScreenshot)
- `src/server/api/routers/project.ts` (used by getUserProjects)
- `src/server/api/routers/action.ts` (used by quickCreate)

---

## How it works end-to-end

1. User is logged into exponential.im in their browser
2. Extension reads the `authjs.session-token` cookie via `chrome.cookies.get()`
3. Extension POSTs cookie value to `/api/auth/extension-token`
4. Backend decodes cookie, generates a 7-day JWT, returns it
5. Extension stores the JWT in `chrome.storage.local`
6. All subsequent API calls use `Authorization: Bearer <jwt>` header
7. tRPC context validates the JWT and creates a session
8. Router middleware sees the session and allows the request
9. When JWT expires, extension re-reads cookie and exchanges again

If no session cookie is found (user not logged in), the extension falls back
to manual API key entry, which works exactly as before via `x-api-key` header.

---

## Token type note

The JWT uses `tokenType: "api-token"` which is already a supported type in
`src/server/utils/jwt.ts`. You may want to add a new type like
`"extension-token"` if you want to distinguish extension-generated tokens
in logs or for scoped permissions. If so, add it to the `JWTTokenType` union
and `DEFAULT_EXPIRY` map.
