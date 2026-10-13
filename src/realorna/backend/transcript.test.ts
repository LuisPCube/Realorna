import assert from "node:assert/strict";
import test from "node:test";
import { parseCaptionPayload, pickCaptionTrack, youtubeId } from "./transcript.ts";

test("youtube id dari watch, shorts, dan youtu.be", () => {
  assert.equal(youtubeId("https://www.youtube.com/watch?v=jNQXAC9IVRw"), "jNQXAC9IVRw");
  assert.equal(youtubeId("https://youtu.be/jNQXAC9IVRw?t=3"), "jNQXAC9IVRw");
  assert.equal(youtubeId("https://www.youtube.com/shorts/jNQXAC9IVRw"), "jNQXAC9IVRw");
  assert.equal(youtubeId("https://www.tiktok.com/@a/video/1"), null);
});

test("json3 dan xml caption jadi satu teks", () => {
  const json3 = JSON.stringify({
    events: [{ segs: [{ utf8: "harga " }, { utf8: "BBM" }] }, { segs: [{ utf8: " naik" }] }],
  });
  assert.equal(parseCaptionPayload(json3), "harga BBM naik");
  assert.equal(
    parseCaptionPayload('<text start="0">harga & BBM</text><text start="1">naik</text>'),
    "harga & BBM naik",
  );
});

test("track bahasa Indonesia lebih diutamakan", () => {
  const chosen = pickCaptionTrack([
    { baseUrl: "https://example.com/en", languageCode: "en", kind: "" },
    { baseUrl: "https://example.com/id", languageCode: "id", kind: "asr" },
  ]);
  assert.equal(chosen?.languageCode, "id");
});
