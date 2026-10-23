import { afterEach, describe, expect, it, vi } from "vitest";
import { facebookPublishText, facebookPublishVideo } from "./facebook";
import type { Media } from "./db/types";
const credentials = {
  appId: "12345",
  pageId: "67890",
  pageAccessToken: "test-page-token",
};
afterEach(() => vi.restoreAllMocks());
describe("Facebook Page text publishing", () => {
  it("posts the approved exact text to the Page feed with its Page token", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: "67890_999" }));
    expect(
      await facebookPublishText(
        "The approved copy.\nSource: https://example.com/original",
        credentials,
      ),
    ).toBe("67890_999");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v25.0/67890/feed");
    expect(options?.method).toBe("POST");
    const form = options?.body as FormData;
    expect(form.get("message")).toBe(
      "The approved copy.\nSource: https://example.com/original",
    );
    expect(form.get("access_token")).toBe(credentials.pageAccessToken);
    expect(form.get("published")).toBe("true");
  });
  it("keeps permission errors and missing post IDs as visible failures", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Missing pages_manage_posts permission" } },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ success: true }));
    await expect(
      facebookPublishText("Approved copy", credentials),
    ).rejects.toThrow("pages_manage_posts");
    await expect(
      facebookPublishText("Approved copy", credentials),
    ).rejects.toThrow("published post id");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects empty or excessive copy before making a publishing call", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(facebookPublishText("  ", credentials)).rejects.toThrow(
      "message",
    );
    await expect(
      facebookPublishText("x".repeat(63207), credentials),
    ).rejects.toThrow("limit");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves the existing uploaded-video flow", async () => {
    const video: Media = {
      id: "video",
      post_id: "post",
      filename: "demo.mp4",
      path: "demo.mp4",
      url: "https://example.com/demo.mp4",
      type: "video",
      target_id: null,
    };
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2])))
      .mockResolvedValueOnce(Response.json({ id: "upload-session" }))
      .mockResolvedValueOnce(Response.json({ h: "uploaded-handle" }))
      .mockResolvedValueOnce(Response.json({ id: "published-video" }));
    expect(
      await facebookPublishVideo("Approved video", [video], credentials),
    ).toBe("published-video");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][0]).toBe(video.url);
    expect(fetcher.mock.calls[3][0]).toBe(
      "https://graph-video.facebook.com/v25.0/67890/videos",
    );
    const form = fetcher.mock.calls[3][1]?.body as FormData;
    expect(form.get("description")).toBe("Approved video");
    expect(form.get("fbuploader_video_file_chunk")).toBe("uploaded-handle");
  });
});
