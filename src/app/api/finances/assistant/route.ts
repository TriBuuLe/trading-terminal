import { z } from "zod";
import { route } from "@/server/api";
import { askAssistant } from "@/server/ai/assistant";
import { aiAvailable } from "@/server/ai/gemini";
import { body } from "@/server/req";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Is the assistant configured (key + consent)? */
export const GET = route(async () => Response.json(aiAvailable()));

/** Ask the finance assistant. Proposed changes come back for the user to apply; nothing is saved here. */
export const POST = route(async (req) => {
  const b = await body(
    req,
    z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(8000) })).min(1).max(40) }),
  );
  return Response.json(await askAssistant(b.messages));
});
