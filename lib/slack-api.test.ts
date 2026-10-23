import { afterEach, describe, expect, it, vi } from "vitest";
import { slackApi } from "./slack";

afterEach(() => vi.unstubAllGlobals());

describe("Slack Web API request encoding", () => {
  it.each([
    ["auth.test", {}],
    ["conversations.info", { channel: "C12345678" }],
    ["conversations.join", { channel: "C12345678" }],
    [
      "conversations.list",
      {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor: "page+/= cursor",
      },
    ],
    ["users.list", { limit: 200, cursor: "people+/= cursor" }],
    ["users.info", { user: "U12345678" }],
  ] satisfies Array<[string, Record<string, unknown>]>)(
    "sends %s parameters as a form instead of an ignored JSON body",
    async (method, data) => {
      const fetcher = vi.fn(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          expect(init?.method).toBe("POST");
          const headers = new Headers(init?.headers);
          expect(headers.get("authorization")).toBe("Bearer xoxb-test");
          expect(headers.get("content-type")).toBe(
            "application/x-www-form-urlencoded; charset=utf-8",
          );
          const form = new URLSearchParams(String(init?.body));
          expect(Object.fromEntries(form)).toEqual(
            Object.fromEntries(
              Object.entries(data).map(([key, value]) => [key, String(value)]),
            ),
          );
          expect(form.has("token")).toBe(false);
          return Response.json({ ok: true });
        },
      );
      vi.stubGlobal("fetch", fetcher);
      await slackApi("xoxb-test", method, data);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0][0]).toBe(`https://slack.com/api/${method}`);
    },
  );

  it("keeps nested review blocks and thread metadata as JSON for chat.postMessage", async () => {
    const packet = {
      channel: "C12345678",
      thread_ts: "123.456",
      text: "Test review",
      unfurl_links: false,
      blocks: [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve test" },
              value: JSON.stringify({ revision: 2, snapshotHash: "abc" }),
            },
          ],
        },
      ],
    };
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("content-type")).toBe(
          "application/json; charset=utf-8",
        );
        expect(JSON.parse(String(init?.body))).toEqual(packet);
        return Response.json({ ok: true, ts: "123.457" });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await slackApi("xoxb-test", "chat.postMessage", packet)).toEqual({
      ok: true,
      ts: "123.457",
    });
  });
});
