/**
 * Publish, step by step. Design: docs/release-management-design.md §6 ("Publish, step by step")
 * and §12.
 *
 * Five steps, each idempotent, **each recorded in `release_events` before the next begins** — so a
 * call that dies half way through is not a half-published release but a resumable one. A retry
 * with the same confirm token reads the steps already recorded and starts at the first that is
 * not, which is why §12 asks that a failure at `manifest_committed` leaves three steps recorded
 * and the retry performs only 4 and 5.
 *
 * 1. `release_upserted`  — find or create the draft release for the tag, record its id.
 * 2. `body_written`      — title, body and the prerelease flag.
 * 3. `release_published` — `draft: false`. **Refused without `RazorReaper-Setup.exe`**: publishing
 *    with no installer strands every client. This is the step that fires the Discord post.
 * 4. `manifest_committed`— one `commitFiles` commit rewriting `update.xml` with **github.com**
 *    URLs, exactly the two substrings `ReleaseReadinessTests` asserts. **Skipped entirely for a
 *    prerelease** (decision 4), and by `skipManifest` for the deliberate case otherwise.
 * 5. `recorded`          — `status = 'published'`, `published_at`, and the `auditPanel` row.
 *
 * `PublishStep` is finer-grained than `ReleaseEventKind`, because the kinds name repo-side facts
 * while the steps name this sequence's progress. The step therefore travels in the event's
 * `detail`, behind a fixed marker, and two steps may legitimately share a kind.
 */
import { isGithubApiError, type GithubReleaseClient } from "./github-release";
import { nowIso } from "./http";
import { auditPanel } from "./panel-access";
import { RELEASE_AUDIT } from "./releases-write";
import { appendEvent, getDraft, listEvents, updateDraft } from "./releases-store";
import type { D1Database, RuntimeEnv } from "./types";
import {
  UPDATE_XML_PATH,
  manifestModelForTag,
  parseUpdateXml,
  renderUpdateXml,
} from "./update-manifest";
import {
  INSTALLER_ASSET_NAME,
  PUBLISH_STEPS,
  notesLines,
  type GithubRelease,
  type PublishStep,
  type ReleaseDraft,
  type ReleaseEvent,
  type ReleaseEventKind,
  type UpdateXmlModel,
} from "../../shared/releases-contract";

/** The prefix a step's `release_events.detail` opens with, and the only thing a resume parses. */
export const PUBLISH_STEP_MARKER = "publish:";

const STEP_PATTERN = new RegExp(`^${PUBLISH_STEP_MARKER}([a-z_]+)`);

/**
 * Step → the `ReleaseEventKind` the row carries. Steps 1 and 2 both write the GitHub release row,
 * and step 5 is the publish itself becoming a fact in the draft, so kinds repeat; the marker in
 * `detail` is what a resume reads.
 */
const STEP_KIND: Record<PublishStep, ReleaseEventKind> = {
  release_upserted: "release_upserted",
  body_written: "release_upserted",
  release_published: "published",
  manifest_committed: "manifest_committed",
  recorded: "published",
};

/** The steps a draft's timeline already carries, in the design's order. */
export function completedStepsFromEvents(events: readonly ReleaseEvent[]): PublishStep[] {
  const done = new Set<string>();
  for (const event of events) {
    const step = STEP_PATTERN.exec(event.detail)?.[1];
    if (step) done.add(step);
  }
  return PUBLISH_STEPS.filter((step) => done.has(step));
}

export interface PublishInput {
  env: RuntimeEnv;
  db: D1Database;
  client: GithubReleaseClient;
  draft: ReleaseDraft;
  /** Panel e-mail. */
  actor: string;
  /** The deliberate skip for a release nobody should auto-update to. */
  skipManifest: boolean;
}

export interface PublishOutcome {
  draft: ReleaseDraft;
  completedSteps: PublishStep[];
  failedStep?: PublishStep;
  failureReason?: string;
  release: GithubRelease | null;
  manifest: UpdateXmlModel | null;
}

/** A step refusing on its own terms — no installer asset, no release id — rather than throwing. */
class PublishStepFailure extends Error {}

function releaseBody(draft: ReleaseDraft): string {
  const full = draft.notesFullMd.trim();
  if (full) return full;
  // §6 step 2: the long-form markdown, "falling back to the bullets". Never a commit log (§1).
  return notesLines(draft.notesCustomer)
    .map((line) => `- ${line}`)
    .join("\n");
}

function hasInstaller(release: GithubRelease): boolean {
  return release.assets.some((asset) => asset.name === INSTALLER_ASSET_NAME);
}

/**
 * Runs the sequence from the first step the draft has not recorded. Never throws for a GitHub or
 * a step failure: the draft goes to `failed`, the outcome names the step, and the same confirm
 * token resumes there until it expires.
 */
export async function runPublish(input: PublishInput): Promise<PublishOutcome> {
  const { env, db, client, actor } = input;
  const timeline = await listEvents(db, { draftId: input.draft.id });
  const done = new Set<PublishStep>(completedStepsFromEvents(timeline));
  const completed: PublishStep[] = [...done];

  let draft = input.draft;
  let release: GithubRelease | null = null;
  let manifest: UpdateXmlModel | null = null;
  let step: PublishStep = "release_upserted";

  const record = async (finished: PublishStep, detail: string): Promise<void> => {
    await appendEvent(db, {
      draftId: draft.id,
      kind: STEP_KIND[finished],
      actor,
      detail: `${PUBLISH_STEP_MARKER}${finished} ${detail}`,
    });
    done.add(finished);
    completed.push(finished);
  };

  const patchDraft = async (
    patch: Parameters<typeof updateDraft>[2],
    allowPublished = false,
  ): Promise<void> => {
    const result = await updateDraft(db, draft.id, patch, { allowPublished });
    if (result.ok) draft = result.draft;
  };

  const requireReleaseId = (): number => {
    if (draft.githubReleaseId === null) {
      throw new PublishStepFailure(
        `The GitHub release for ${draft.tag} is not recorded on this draft — publish again to recreate it.`,
      );
    }
    return draft.githubReleaseId;
  };

  try {
    /* 1 — find or create the release for the tag, as a draft. */
    if (!done.has("release_upserted")) {
      release = await client.findReleaseByTag(draft.tag);
      if (!release) {
        release = await client.createRelease({
          tag: draft.tag,
          name: draft.title || draft.tag,
          body: releaseBody(draft),
          draft: true,
          prerelease: draft.prerelease,
        });
      }
      if (draft.githubReleaseId !== release.id) await patchDraft({ githubReleaseId: release.id });
      await record("release_upserted", `${draft.tag} is release ${release.id} on GitHub.`);
    }

    /* 2 — title, body and the prerelease flag. */
    step = "body_written";
    if (!done.has("body_written")) {
      release = await client.updateRelease(requireReleaseId(), {
        name: draft.title || draft.tag,
        body: releaseBody(draft),
        prerelease: draft.prerelease,
      });
      await record("body_written", `${draft.tag} carries its title and notes.`);
    }

    /* 3 — publish. The one call in the panel that fires a GitHub release event. */
    step = "release_published";
    if (!done.has("release_published")) {
      const current = release ?? (await client.getRelease(requireReleaseId()));
      if (!hasInstaller(current)) {
        throw new PublishStepFailure(
          `${draft.tag} carries no ${INSTALLER_ASSET_NAME}; publishing it would strand every client. Build first, then publish again.`,
        );
      }
      // Already published is the resume case: re-PATCHing `draft: false` fires nothing, but
      // skipping it keeps the sequence honest about which call did the publishing.
      release = current.state === "draft" ? await client.publishRelease(current.id) : current;
      await record("release_published", `${draft.tag} is published on GitHub.`);
    }

    /* 4 — update.xml. Never for a prerelease (decision 4), never when skipManifest is set. */
    step = "manifest_committed";
    const skipManifest = draft.prerelease || input.skipManifest;
    if (!skipManifest && !done.has("manifest_committed")) {
      const blob = await client.getContent(UPDATE_XML_PATH, { essential: true, fresh: true });
      const previous = blob?.content ? parseUpdateXml(blob.content) : null;
      manifest = manifestModelForTag({
        tag: draft.tag,
        version: draft.version,
        mandatory: draft.mandatory,
        notes: notesLines(draft.notesCustomer),
        args: previous?.args,
        repo: client.repo,
      });
      const commit = await client.commitFiles({
        files: [
          { path: UPDATE_XML_PATH, content: renderUpdateXml(manifest), baseSha: blob?.sha ?? null },
        ],
        message: draft.commitMessage,
      });
      await record(
        "manifest_committed",
        `update.xml pins ${draft.tag} (${commit.commitSha.slice(0, 7)}).`,
      );
    }

    /* 5 — the draft becomes a published release, in the row and in panel_audit. */
    step = "recorded";
    if (!done.has("recorded")) {
      await patchDraft({ status: "published", publishedAt: nowIso() }, true);
      await record("recorded", `${draft.tag} is published.`);
      await auditPanel(
        env,
        actor,
        draft.tag,
        RELEASE_AUDIT.publish,
        `Published ${draft.tag}${skipManifest ? " without rewriting update.xml" : ""}.`,
      );
    }

    return { draft, completedSteps: completed, release, manifest };
  } catch (cause) {
    const failureReason = publishFailureReason(cause);
    await appendEvent(db, {
      draftId: draft.id,
      kind: "error",
      actor,
      detail: `${PUBLISH_STEP_MARKER}failed at ${step}: ${failureReason}`,
    }).catch((err) => console.error("releases: publish error event not written", err));
    // `failed` is reachable from `published` too (§3): a resume that dies at step 5 must not be
    // left claiming success, and the completed steps it already recorded stay where they are.
    await updateDraft(db, draft.id, { status: "failed" }, { allowPublished: true }).catch((err) =>
      console.error("releases: publish failure not recorded on the draft", err),
    );
    const reloaded = await getDraft(db, draft.id).catch(() => null);
    return {
      draft: reloaded ?? draft,
      completedSteps: completed,
      failedStep: step,
      failureReason,
      release,
      manifest,
    };
  }
}

/**
 * One sentence, safe to return. A `GithubApiError`'s message is written by `github-release.ts` and
 * never carries a GitHub body; anything else collapses, because no caught error's text may reach a
 * browser.
 */
function publishFailureReason(cause: unknown): string {
  if (cause instanceof PublishStepFailure) return cause.message;
  if (isGithubApiError(cause)) return cause.message;
  console.error("releases: publish failed", cause);
  return "The publish could not be completed. Reload the page and try again.";
}
