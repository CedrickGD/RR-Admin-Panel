/**
 * The pure helpers behind the read half: `functions/_lib/update-manifest.ts` (what `update.xml`
 * says) and `functions/_lib/release-files.ts` (which repository paths the panel may touch).
 * Design §6, §8 and §11.
 */
import { describe, expect, it } from "vitest";

import {
  fileEditRefusal,
  isReadableRepoPath,
  isWorkflowPath,
  normaliseRepoPath,
} from "../functions/_lib/release-files";
import { manifestNotes, parseUpdateXml, updateXmlState } from "../functions/_lib/update-manifest";

const REPO = "CedrickGD/RazorReaper";

const LIVE_MANIFEST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<item>",
  "    <version>1.5.2.0</version>",
  `    <url>https://github.com/${REPO}/releases/download/v1.5.2/RazorReaper-Setup.exe</url>`,
  `    <changelog>https://github.com/${REPO}/releases/tag/v1.5.2</changelog>`,
  "    <mandatory>false</mandatory>",
  "    <args>/VERYSILENT /SUPPRESSMSGBOXES /NORESTART</args>",
  "    <notes>",
  "- Connect your account with Discord &amp; use your picture everywhere.",
  "- Feedback now requires a written description.",
  "    </notes>",
  "</item>",
].join("\n");

describe("parseUpdateXml", () => {
  it("reads the five elements and the bullets the file actually carries", () => {
    expect(parseUpdateXml(LIVE_MANIFEST)).toEqual({
      version: "1.5.2.0",
      url: `https://github.com/${REPO}/releases/download/v1.5.2/RazorReaper-Setup.exe`,
      changelog: `https://github.com/${REPO}/releases/tag/v1.5.2`,
      mandatory: false,
      args: "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART",
      notes: [
        "Connect your account with Discord & use your picture everywhere.",
        "Feedback now requires a written description.",
      ],
    });
  });

  it("reads <mandatory>true</mandatory> as the boolean it is", () => {
    expect(
      parseUpdateXml("<item><version>1.0.0.0</version><mandatory>TRUE</mandatory></item>")
        ?.mandatory,
    ).toBe(true);
  });

  it("returns null without a <version> rather than guessing what customers are offered", () => {
    expect(parseUpdateXml("<item><mandatory>false</mandatory></item>")).toBeNull();
    expect(parseUpdateXml("")).toBeNull();
  });

  it("strips the bullet prefix and drops blank lines", () => {
    expect(manifestNotes("\n- One\n\n* Two\n   \n")).toEqual(["One", "Two"]);
    expect(manifestNotes(null)).toEqual([]);
  });
});

describe("updateXmlState", () => {
  const blob = { path: "update.xml", sha: "blob-sha", size: 1, content: LIVE_MANIFEST };

  it("pins the tag the committed <url> resolves to, and knows when it is the latest", () => {
    expect(updateXmlState(blob, "v1.5.2", "2026-09-17T00:00:00.000Z")).toMatchObject({
      sha: "blob-sha",
      pinnedTag: "v1.5.2",
      pinnedTagIsLatest: true,
      fetchedAt: "2026-09-17T00:00:00.000Z",
    });
  });

  it("says the pin is not the latest when a newer release exists", () => {
    expect(updateXmlState(blob, "v1.5.3")?.pinnedTagIsLatest).toBe(false);
  });

  it("reports no pinned tag when <url> is not a release download", () => {
    const odd = LIVE_MANIFEST.replace(/<url>[\s\S]*?<\/url>/, "<url>https://example.test/x</url>");
    expect(updateXmlState({ ...blob, content: odd }, "v1.5.2")).toMatchObject({
      pinnedTag: null,
      pinnedTagIsLatest: false,
    });
  });

  it("is null for a blob that is missing or unreadable", () => {
    expect(updateXmlState(null, "v1.5.2")).toBeNull();
    expect(updateXmlState({ ...blob, content: null }, "v1.5.2")).toBeNull();
  });
});

describe("normaliseRepoPath", () => {
  it.each([
    ["installer/RazorReaper.iss", "installer/RazorReaper.iss"],
    ["installer\\RazorReaper.iss", "installer/RazorReaper.iss"],
    ["  update.xml  ", "update.xml"],
    ["installer//assets///icon.ico", "installer/assets/icon.ico"],
    ["./update.xml", "update.xml"],
  ])("normalises %s", (raw, expected) => {
    expect(normaliseRepoPath(raw)).toBe(expected);
  });

  it.each(["", "   ", ".", "/etc/passwd", "../secrets", "installer/../../etc"])(
    "refuses %s",
    (raw) => {
      expect(normaliseRepoPath(raw)).toBeNull();
    },
  );
});

describe("fileEditRefusal", () => {
  it("lets an ordinary source file through", () => {
    expect(fileEditRefusal("installer/RazorReaper.iss")).toBeNull();
    expect(fileEditRefusal("RazorReaper/RazorReaper.csproj")).toBeNull();
  });

  it("allows a workflow file — it needs its own confirmation, not a refusal", () => {
    expect(fileEditRefusal(".github/workflows/build-installer.yml")).toBeNull();
    expect(isWorkflowPath(".github/workflows/build-installer.yml")).toBe(true);
    expect(isWorkflowPath("installer/RazorReaper.iss")).toBe(false);
  });

  it("refuses update.xml, pointing at the two actions that own it", () => {
    expect(fileEditRefusal("update.xml")).toContain("Publish and Make current");
    expect(fileEditRefusal("./UPDATE.XML")).toContain("Publish and Make current");
    // Governed is not secret: the Files tab still opens it read-only.
    expect(isReadableRepoPath("update.xml")).toBe(true);
  });

  it.each([
    "Self-Sign/RazorReaperCodeSign.pfx",
    "keys/strong.snk",
    "deploy/nas/admin.env",
    "deploy/nas/.env.production",
    "RazorReaper/appsettings.json",
    "RazorReaper/appsettings.Development.json",
    ".git/config",
  ])("refuses %s in both directions", (path) => {
    expect(fileEditRefusal(path)).not.toBeNull();
    expect(isReadableRepoPath(path)).toBe(false);
  });

  it("does not mistake a lookalike for a secret", () => {
    expect(fileEditRefusal("docs/environment.md")).toBeNull();
    expect(fileEditRefusal("src/settings.json")).toBeNull();
  });
});
