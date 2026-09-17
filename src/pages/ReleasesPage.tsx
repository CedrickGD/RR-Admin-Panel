/**
 * Release management — the page behind `#/releases` (docs/release-management-design.md §9).
 *
 * Four sections behind `ds/Tabs`: the published releases, the drafts and their editor, the
 * repository's workflows, and the file editor. Workflows and Files are **absent**, not disabled,
 * without `releases.files` (decision 2) — a seat that can never commit is not shown a commit box.
 *
 * Two rules the rest of the file exists to keep:
 *
 *  - **The page composes no consequence copy.** Every governed action (build, publish,
 *    make-current, unpublish, commit, dispatch) opens a modal that prints the server's
 *    `ConfirmEffect[]` verbatim and in order (§6). There is no illustrative, defaulted or
 *    reordered effect line anywhere below; if the mint fails, the modal shows the refusal and
 *    offers no confirm button at all.
 *  - **A write button is disabled with its reason as the title.** While `token.canWrite` is
 *    false a status line sits under the `PageHeader` carrying the server's sentence (decision 8),
 *    and the same sentence is every write control's `title`. Row-level refusals — a draft, a
 *    prerelease, a release with no installer asset, the already-current tag — read the same way.
 *
 * The page makes one call on load (`GET /api/admin/releases`); the other tabs fetch when they
 * are opened. The data layer is `src/hooks/useReleases.ts`.
 */
import {
  ArrowLeft,
  CircleCheck,
  CircleDot,
  Clock3,
  Copy,
  ExternalLink,
  FileCode2,
  FileText,
  FolderOpen,
  Github,
  Hammer,
  Info,
  MessageCircle,
  Package,
  PlayCircle,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Send,
  ShieldAlert,
  Trash2,
  Undo2,
  Upload,
  Users,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { KpiStatCard } from "../components/KpiStatCard";
import { Badge, type BadgeProps } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { DataTable, type DataTableColumn } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { Field, FormError } from "../components/ds/Field";
import { Input, Textarea } from "../components/ds/Input";
import { Modal, ModalActions } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SearchInput } from "../components/ds/SearchInput";
import { SegmentedControl } from "../components/ds/SegmentedControl";
import { Select } from "../components/ds/Select";
import { Skeleton } from "../components/ds/Skeleton";
import { Spinner } from "../components/ds/Tag";
import { Tabs, type TabItem } from "../components/ds/Tabs";
import { usePanelPermission } from "../hooks/usePanelPermission";
import {
  buildDraft,
  commitRepoFile,
  createDraft,
  deleteDraft,
  dispatchWorkflow,
  fetchCommitsSince,
  fetchRepoPath,
  makeCurrent,
  makeCurrentCandidatesOf,
  mintConfirmToken,
  publishDraft,
  releasesErrorMessage,
  saveDraft,
  unpublishRelease,
  useReleases,
  useRunStatus,
  useWorkflows,
  type RepoPathResponse,
} from "../hooks/useReleases";
import "../theme/releases-workspace.css";
import {
  INSTALLER_ASSET_NAME,
  nextPatch,
  notesLines,
  tagForVersion,
  versionForTag,
  type CommitSummary,
  type ConfirmAction,
  type ConfirmEffect,
  type ConfirmEffectKind,
  type GithubRelease,
  type MakeCurrentCandidate,
  type ReleaseDraft,
  type ReleaseDraftStatus,
  type ReleasesOverviewResponse,
  type RepoFile,
  type RepoTreeEntry,
  type RunDetailResponse,
  type UpdateXmlState,
  type WorkflowInputSpec,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from "../../shared/releases-contract";

type ReleasesTab = "releases" | "drafts" | "workflows" | "files";
type ReleaseFilter = "all" | "published" | "draft" | "prerelease";

const RELEASE_FILTERS: TabItem<ReleaseFilter>[] = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Draft" },
  { key: "prerelease", label: "Prerelease" },
];

const STATE_TONE: Record<GithubRelease["state"], "success" | "warning" | "muted"> = {
  published: "success",
  prerelease: "warning",
  draft: "muted",
};

const DRAFT_TONE: Record<ReleaseDraftStatus, BadgeProps["tone"]> = {
  draft: "muted",
  building: "info",
  built: "accent",
  published: "success",
  failed: "danger",
};

const DRAFT_LABEL: Record<ReleaseDraftStatus, string> = {
  draft: "Draft",
  building: "Building",
  built: "Built",
  published: "Published",
  failed: "Failed",
};

/** The icon well beside a server effect line. The line's own wording is never touched. */
const EFFECT_ICON: Record<ConfirmEffectKind, ReactNode> = {
  github: <Github size={14} />,
  manifest: <FileCode2 size={14} />,
  installs: <Users size={14} />,
  discord: <MessageCircle size={14} />,
  note: <Info size={14} />,
};

const NOTES_HOST = "https://dl.razorreaper.app/release-notes";

function notesPageLink(tag: string): string {
  return `${NOTES_HOST}/${tag}`;
}

function defaultTitle(version: string): string {
  return `RazorReaper ${version}`;
}

function defaultCommitMessage(version: string): string {
  return `release: ${version}`;
}

function hasInstaller(release: GithubRelease): boolean {
  return release.assets.some((asset) => asset.name === INSTALLER_ASSET_NAME);
}

/** Why Make current is refused for this release, or null when it is offered. §9. */
function makeCurrentRefusal(release: GithubRelease, pinnedTag: string | null): string | null {
  if (release.state === "draft") return `${release.tag} is still a draft.`;
  if (release.state === "prerelease") return `${release.tag} is a prerelease.`;
  if (!hasInstaller(release)) return `${release.tag} carries no ${INSTALLER_ASSET_NAME}.`;
  if (pinnedTag === release.tag) return `update.xml already points at ${release.tag}.`;
  return null;
}

function unpublishRefusal(release: GithubRelease): string | null {
  return release.state === "draft" ? `${release.tag} is already a draft.` : null;
}

/** `disabled` plus the reason as the control's title — the one shape every guarded button uses. */
function guard(reason: string | null): { disabled: boolean; title: string | undefined } {
  return { disabled: reason !== null, title: reason ?? undefined };
}

/** First customer bullet, or the first line of the release body — one line, never a commit log. */
function notesPreview(release: GithubRelease): string {
  const [first] = notesLines(release.body);
  return first ?? "";
}

function formatBytes(size: number | null): string {
  if (size === null || !Number.isFinite(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function runTone(run: WorkflowRunSummary | null): "success" | "warning" | "danger" | "muted" {
  if (!run) return "muted";
  if (run.status !== "completed") return "warning";
  if (run.conclusion === "success") return "success";
  if (run.conclusion === null || run.conclusion === "skipped") return "muted";
  return "danger";
}

function runLabel(run: WorkflowRunSummary | null): string {
  if (!run) return "—";
  if (run.status === "queued") return "Queued";
  if (run.status === "in_progress") return "Running";
  if (run.status === "unknown") return "Unknown";
  if (!run.conclusion) return "Finished";
  return run.conclusion.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/* ─────────────────────────────── The confirm dialog ─────────────────────────────── */

interface ConfirmResult {
  token: string;
  commitMessage: string;
  workflowsConfirm: boolean;
}

interface ConfirmSpec {
  action: ConfirmAction;
  subject: string;
  /** Names the action and its target. Never its consequences — those are the server's lines. */
  title: string;
  confirmLabel: string;
  danger?: boolean;
  /** Text the operator must type before the button enables (§9: publish and make-current). */
  typeToConfirm?: string;
  /** Initial value when the action commits with an operator-editable message. */
  commitMessage?: string;
  /** A path under `.github/workflows` takes its own second confirmation (§11). */
  workflowsStep?: boolean;
  run: (input: ConfirmResult) => Promise<void>;
}

function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  const [effects, setEffects] = useState<ConfirmEffect[]>([]);
  const [token, setToken] = useState("");
  const [minting, setMinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<"effects" | "workflows">("effects");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!spec) return;
    let cancelled = false;
    setEffects([]);
    setToken("");
    setFailure(null);
    setTyped("");
    setMessage(spec.commitMessage ?? "");
    setStep("effects");
    setAcknowledged(false);
    setMinting(true);
    mintConfirmToken(spec.action, spec.subject)
      .then((minted) => {
        if (cancelled) return;
        setToken(minted.token);
        setEffects(minted.effects);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setFailure(releasesErrorMessage(cause, "This action could not be prepared."));
      })
      .finally(() => {
        if (!cancelled) setMinting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spec]);

  if (!spec) return <Modal open={false} />;

  const typedOk = !spec.typeToConfirm || typed.trim() === spec.typeToConfirm;
  const ready =
    Boolean(token) && typedOk && (spec.commitMessage === undefined || message.trim().length > 0);

  async function commit() {
    if (!spec || !token) return;
    setBusy(true);
    setFailure(null);
    try {
      await spec.run({ token, commitMessage: message.trim(), workflowsConfirm: acknowledged });
      onClose();
    } catch (cause) {
      setFailure(releasesErrorMessage(cause, "The action was refused."));
    } finally {
      setBusy(false);
    }
  }

  const atWorkflowsStep = step === "workflows";

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnScrim={false}
      title={atWorkflowsStep ? "Edit a workflow file?" : spec.title}
    >
      {minting ? (
        <p className="releases-dialog-wait">
          <Spinner small /> Reading what this will do…
        </p>
      ) : null}

      {!minting && !atWorkflowsStep && effects.length > 0 ? (
        <ul className="releases-effects">
          {effects.map((effect, index) => (
            <li key={`${effect.kind}-${index}`} className="releases-effect">
              <span className="releases-effect-icon" aria-hidden="true">
                {EFFECT_ICON[effect.kind]}
              </span>
              <span>{effect.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {atWorkflowsStep ? (
        <label className="toggle-row releases-ack">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            Commit {spec.subject}
            <small>A file under .github/workflows takes its own confirmation.</small>
          </span>
        </label>
      ) : null}

      {!minting && !atWorkflowsStep && spec.commitMessage !== undefined ? (
        <Field label="Commit message" hint="required">
          <Input value={message} onChange={(event) => setMessage(event.target.value)} />
        </Field>
      ) : null}

      {!minting && !atWorkflowsStep && spec.typeToConfirm ? (
        <Field label={`Type ${spec.typeToConfirm} to confirm`} hint="required">
          <Input
            value={typed}
            mono
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
      ) : null}

      <FormError message={failure} />

      <ModalActions>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {token ? (
          spec.workflowsStep && !atWorkflowsStep ? (
            <Button variant="primary" disabled={!ready} onClick={() => setStep("workflows")}>
              Continue
            </Button>
          ) : (
            <Button
              variant={spec.danger ? "danger" : "primary"}
              disabled={!ready || busy || (atWorkflowsStep && !acknowledged)}
              onClick={() => void commit()}
            >
              {busy ? "Working…" : spec.confirmLabel}
            </Button>
          )
        ) : null}
      </ModalActions>
    </Modal>
  );
}

/* ──────────────────────────────── Releases section ──────────────────────────────── */

interface ReleasesSectionProps {
  data: ReleasesOverviewResponse;
  writeBlock: string | null;
  onConfirm: (spec: ConfirmSpec) => void;
  onEditNotes: (draft: ReleaseDraft) => void;
  refresh: () => void;
  notify: (message: string) => void;
}

function ReleasesSection({
  data,
  writeBlock,
  onConfirm,
  onEditNotes,
  refresh,
  notify,
}: ReleasesSectionProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReleaseFilter>("all");
  const [openNotes, setOpenNotes] = useState<GithubRelease | null>(null);
  // The 409 an unpublish comes back with while update.xml still pins the tag: the server's
  // sentence, and the make-current candidates it offers as the explicit second action (§6).
  const [blocked, setBlocked] = useState<{
    reason: string;
    candidates: MakeCurrentCandidate[];
  } | null>(null);

  const pinnedTag = data.updateXml?.pinnedTag ?? null;
  const draftByTag = useMemo(() => {
    const map = new Map<string, ReleaseDraft>();
    for (const draft of data.drafts) map.set(draft.tag, draft);
    return map;
  }, [data.drafts]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.releases.filter((release) => {
      if (filter !== "all" && release.state !== filter) return false;
      if (!needle) return true;
      return `${release.tag} ${release.name}`.toLowerCase().includes(needle);
    });
  }, [data.releases, filter, query]);

  const startMakeCurrent = useCallback(
    (releaseId: number, tag: string) => {
      onConfirm({
        action: "make-current",
        subject: String(releaseId),
        title: `Point update.xml at ${tag}?`,
        confirmLabel: "Make current",
        danger: true,
        typeToConfirm: tag,
        commitMessage: `release: point update.xml at ${tag}`,
        run: async ({ token, commitMessage }) => {
          await makeCurrent(releaseId, {
            confirmToken: token,
            commitMessage,
            expectedCurrentTag: pinnedTag,
          });
          setBlocked(null);
          notify(`update.xml now points at ${tag}.`);
          refresh();
        },
      });
    },
    [notify, onConfirm, pinnedTag, refresh],
  );

  const startUnpublish = useCallback(
    (release: GithubRelease) => {
      onConfirm({
        action: "unpublish",
        subject: String(release.id),
        title: `Unpublish ${release.tag} to draft?`,
        confirmLabel: "Unpublish",
        danger: true,
        run: async ({ token }) => {
          try {
            await unpublishRelease(release.id, token);
          } catch (cause) {
            const candidates = makeCurrentCandidatesOf(cause);
            if (candidates.length > 0) {
              setBlocked({
                reason: releasesErrorMessage(cause, "The release could not be unpublished."),
                candidates,
              });
            }
            throw cause;
          }
          setBlocked(null);
          notify(`${release.tag} is a draft again.`);
          refresh();
        },
      });
    },
    [notify, onConfirm, refresh],
  );

  const columns: DataTableColumn<GithubRelease>[] = [
    {
      key: "tag",
      header: "Tag",
      mono: true,
      minWidth: 150,
      render: (release) => (
        <span className="releases-tag-cell">
          <span className="mono">{release.tag}</span>
          {pinnedTag === release.tag ? <Badge tone="accent">Current</Badge> : null}
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      minWidth: 104,
      render: (release) => <Badge tone={STATE_TONE[release.state]}>{release.state}</Badge>,
    },
    {
      key: "assets",
      header: "Assets",
      numeric: true,
      minWidth: 86,
      render: (release) => (
        <span title={release.assets.map((asset) => asset.name).join("\n") || undefined}>
          {release.assets.length}
        </span>
      ),
    },
    {
      key: "published",
      header: "Published",
      minWidth: 128,
      render: (release) =>
        release.publishedAt ? <RelativeTime iso={release.publishedAt} /> : <span>—</span>,
    },
    {
      key: "notes",
      header: "Notes",
      muted: true,
      minWidth: 180,
      maxWidth: 280,
      render: (release) => (
        <span title={notesPreview(release)}>{notesPreview(release) || "—"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      label: "Actions",
      minWidth: 260,
      render: (release) => {
        const draft = draftByTag.get(release.tag);
        const current = makeCurrentRefusal(release, pinnedTag);
        const unpublish = unpublishRefusal(release);
        return (
          <div className="row-actions">
            <Button size="sm" icon={<FileText />} onClick={() => setOpenNotes(release)}>
              Notes
            </Button>
            {draft ? (
              <Button size="sm" onClick={() => onEditNotes(draft)}>
                Edit notes
              </Button>
            ) : null}
            <Button
              size="sm"
              icon={<Undo2 />}
              {...guard(writeBlock ?? current)}
              onClick={() => startMakeCurrent(release.id, release.tag)}
            >
              Make current
            </Button>
            <Button
              size="sm"
              {...guard(writeBlock ?? unpublish)}
              onClick={() => startUnpublish(release)}
            >
              Unpublish
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageToolbar
        aria-label="Release filters"
        left={
          <SegmentedControl
            aria-label="Filter releases by state"
            items={RELEASE_FILTERS}
            value={filter}
            onChange={setFilter}
          />
        }
        search={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search tag or title…"
            style={{ maxWidth: 280 }}
          />
        }
        canReset={filter !== "all" || query !== ""}
        onReset={() => {
          setFilter("all");
          setQuery("");
        }}
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Releases</h2>
            <p className="section-sub">
              {data.updateXml?.pinnedTag
                ? `update.xml points at ${data.updateXml.pinnedTag}.`
                : "update.xml points at no recognised tag."}
            </p>
          </div>
        </div>
        {blocked ? (
          <div className="releases-blocked" role="alert">
            <p>{blocked.reason}</p>
            {blocked.candidates.length > 0 ? (
              <ul className="releases-candidates">
                {blocked.candidates.map((candidate) => (
                  <li key={candidate.releaseId}>
                    <span className="mono">{candidate.tag}</span>
                    <Button
                      size="sm"
                      icon={<Undo2 />}
                      {...guard(writeBlock)}
                      onClick={() => startMakeCurrent(candidate.releaseId, candidate.tag)}
                    >
                      Make current
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {rows.length > 0 ? (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(release) => release.id}
            mobileLayout="stack"
            stickyActions
            caption="Releases on GitHub"
          />
        ) : (
          <EmptyState
            icon={<Package />}
            title="No release matches"
            action={
              query || filter !== "all" ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
          >
            The repository has no release in this view.
          </EmptyState>
        )}
      </section>

      <Modal
        open={Boolean(openNotes)}
        onClose={() => setOpenNotes(null)}
        title={openNotes?.tag}
        sub={openNotes?.name}
      >
        <div className="releases-notes-body">
          {openNotes?.body ? <pre>{openNotes.body}</pre> : <p>This release carries no notes.</p>}
        </div>
        <ModalActions align="between">
          <Button
            size="sm"
            icon={<Copy />}
            onClick={() => {
              if (openNotes) void navigator.clipboard?.writeText(notesPageLink(openNotes.tag));
            }}
          >
            Copy notes link
          </Button>
          <Button variant="ghost" onClick={() => setOpenNotes(null)}>
            Close
          </Button>
        </ModalActions>
      </Modal>
    </>
  );
}

/* ───────────────────────────────── Drafts section ───────────────────────────────── */

interface DraftForm {
  id: number | null;
  version: string;
  tag: string;
  title: string;
  notesCustomer: string;
  notesFullMd: string;
  commitMessage: string;
  mandatory: boolean;
  prerelease: boolean;
  status: ReleaseDraftStatus;
  updatedAt: string | null;
}

function formFromDraft(draft: ReleaseDraft): DraftForm {
  return {
    id: draft.id,
    version: draft.version,
    tag: draft.tag,
    title: draft.title,
    notesCustomer: draft.notesCustomer,
    notesFullMd: draft.notesFullMd,
    commitMessage: draft.commitMessage,
    mandatory: draft.mandatory,
    prerelease: draft.prerelease,
    status: draft.status,
    updatedAt: draft.updatedAt,
  };
}

function blankForm(latestVersion: string): DraftForm {
  const version = nextPatch(latestVersion);
  return {
    id: null,
    version,
    tag: tagForVersion(version),
    title: defaultTitle(version),
    notesCustomer: "",
    notesFullMd: "",
    commitMessage: defaultCommitMessage(version),
    mandatory: false,
    prerelease: false,
    status: "draft",
    updatedAt: null,
  };
}

/** A derived field follows the version only while it still holds the value it derived from. */
function withVersion(form: DraftForm, version: string): DraftForm {
  const next: DraftForm = { ...form, version };
  if (form.tag === tagForVersion(form.version)) next.tag = tagForVersion(version);
  if (form.title === defaultTitle(form.version)) next.title = defaultTitle(version);
  if (form.commitMessage === defaultCommitMessage(form.version))
    next.commitMessage = defaultCommitMessage(version);
  return next;
}

function RunPanel({ detail, error }: { detail: RunDetailResponse | null; error: string | null }) {
  if (error) return <FormError message={error} />;
  if (!detail || !detail.run) return null;
  const run = detail.run;
  return (
    <div className="releases-run">
      <div className="releases-run-head">
        <Badge tone={runTone(run)}>{runLabel(run)}</Badge>
        <span className="mono">
          {run.name} #{run.runNumber}
        </span>
        <RelativeTime iso={run.updatedAt} />
        <a href={run.htmlUrl} target="_blank" rel="noreferrer noopener">
          Open on GitHub <ExternalLink size={12} />
        </a>
      </div>
      {detail.jobs.length > 0 ? (
        <ul className="releases-run-jobs">
          {detail.jobs.map((job) => (
            <li key={job.id}>
              <span>{job.name}</span>
              <span className="muted">{job.currentStep ?? runLabel(run)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {detail.logTail.length > 0 ? (
        <pre className="releases-log" aria-label="Build log tail">
          {detail.logTail.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

interface DraftsSectionProps {
  data: ReleasesOverviewResponse;
  writeBlock: string | null;
  onConfirm: (spec: ConfirmSpec) => void;
  refresh: () => void;
  notify: (message: string) => void;
  form: DraftForm | null;
  setForm: (form: DraftForm | null) => void;
}

function DraftsSection({
  data,
  writeBlock,
  onConfirm,
  refresh,
  notify,
  form,
  setForm,
}: DraftsSectionProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [commits, setCommits] = useState<CommitSummary[] | null>(null);
  const [commitsError, setCommitsError] = useState<string | null>(null);

  const latestVersion = data.latestPublished ? versionForTag(data.latestPublished.tag) : "1.0.0";
  const building = form?.status === "building";
  const run = useRunStatus(building ? (form?.id ?? null) : null, building, refresh);

  const openCommits = useCallback(async () => {
    if (commits) return;
    try {
      const payload = await fetchCommitsSince(data.latestPublished?.tag ?? null);
      setCommits(payload.commits);
      setCommitsError(null);
    } catch (cause) {
      setCommitsError(releasesErrorMessage(cause, "The commit list could not be read."));
    }
  }, [commits, data.latestPublished]);

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        version: form.version.trim(),
        tag: form.tag.trim(),
        title: form.title.trim(),
        notesCustomer: form.notesCustomer,
        notesFullMd: form.notesFullMd,
        commitMessage: form.commitMessage.trim(),
        mandatory: form.mandatory,
        prerelease: form.prerelease,
      };
      const result =
        form.id === null
          ? await createDraft(payload)
          : await saveDraft(form.id, {
              ...payload,
              expectedUpdatedAt: form.updatedAt ?? undefined,
            });
      setForm(formFromDraft(result.draft));
      notify(`Draft ${result.draft.tag} saved.`);
      refresh();
    } catch (cause) {
      setSaveError(releasesErrorMessage(cause, "The draft could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(draft: ReleaseDraft) {
    try {
      await deleteDraft(draft.id);
      if (form?.id === draft.id) setForm(null);
      notify(`Draft ${draft.tag} deleted.`);
      refresh();
    } catch (cause) {
      setSaveError(releasesErrorMessage(cause, "The draft could not be deleted."));
    }
  }

  function startBuild() {
    if (!form || form.id === null) return;
    const draftId = form.id;
    onConfirm({
      action: "build",
      subject: String(draftId),
      title: `Build the installer for ${form.tag}?`,
      confirmLabel: "Build installer",
      run: async ({ token }) => {
        const result = await buildDraft(draftId, { confirmToken: token });
        setForm(formFromDraft(result.draft));
        notify(`Build dispatched for ${result.draft.tag}.`);
        refresh();
      },
    });
  }

  function startPublish() {
    if (!form || form.id === null) return;
    const draftId = form.id;
    const status = form.status;
    onConfirm({
      action: "publish",
      subject: String(draftId),
      title: `Publish ${form.tag}?`,
      confirmLabel: "Publish",
      danger: true,
      typeToConfirm: form.tag,
      run: async ({ token }) => {
        const result = await publishDraft(draftId, {
          confirmToken: token,
          expectedStatus: status,
          skipManifest: false,
        });
        setForm(formFromDraft(result.draft));
        notify(
          result.failedStep
            ? `Publish stopped at ${result.failedStep}. Confirm again to resume.`
            : `${result.draft.tag} is published.`,
        );
        refresh();
      },
    });
  }

  const preview = form ? notesLines(form.notesCustomer) : [];
  const unsaved = form?.id === null ? "Save the draft before building it." : null;
  // `failed` stays publishable: §6 resumes a publish at the step it stopped on.
  const notBuilt =
    form === null || form.status === "built" || form.status === "failed"
      ? null
      : form.status === "published"
        ? `${form.tag} is already published.`
        : "Build the installer before publishing.";

  return (
    <div className="releases-editor-layout">
      <section className="panel releases-draft-list">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Drafts</h2>
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={<Plus />}
            {...guard(writeBlock)}
            onClick={() => setForm(blankForm(latestVersion))}
          >
            New draft
          </Button>
        </div>
        {data.drafts.length === 0 ? (
          <EmptyState icon={<Rocket />} title="No drafts yet">
            A draft is where a release is shaped before the runner builds it.
          </EmptyState>
        ) : (
          <ul className="releases-draft-rows">
            {data.drafts.map((draft) => (
              <li key={draft.id} className={form?.id === draft.id ? "is-active" : undefined}>
                <Button
                  size="sm"
                  className="releases-draft-open"
                  onClick={() => setForm(formFromDraft(draft))}
                >
                  <span className="mono">{draft.tag}</span>
                  <Badge tone={DRAFT_TONE[draft.status]}>{DRAFT_LABEL[draft.status]}</Badge>
                </Button>
                <Button
                  size="sm"
                  icon={<Trash2 />}
                  aria-label={`Delete draft ${draft.tag}`}
                  {...guard(
                    writeBlock ??
                      (draft.status === "draft" || draft.status === "failed"
                        ? null
                        : `${draft.tag} is ${DRAFT_LABEL[draft.status].toLowerCase()}.`),
                  )}
                  onClick={() => void remove(draft)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel releases-draft-editor">
        {!form ? (
          <EmptyState icon={<FileText />} title="No draft open">
            Pick a draft on the left, or start a new one.
          </EmptyState>
        ) : (
          <>
            <div className="panel-head">
              <div className="panel-head-left">
                <h2 className="section-title">{form.tag || "New draft"}</h2>
                <p className="section-sub">{DRAFT_LABEL[form.status]}</p>
              </div>
            </div>
            <div className="panel-body releases-editor-fields">
              <div className="releases-editor-row">
                <Field label="Version" hint="required" help="Suggested: the next patch.">
                  <Input
                    value={form.version}
                    mono
                    onChange={(event) => setForm(withVersion(form, event.target.value))}
                  />
                </Field>
                <Field label="Tag" hint="required">
                  <Input
                    value={form.tag}
                    mono
                    onChange={(event) => setForm({ ...form, tag: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Title">
                <Input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </Field>

              <div className="releases-notes-split">
                <Field
                  label="Customer notes"
                  help="One bullet per line. This is what the app's What's-new list shows."
                >
                  <Textarea
                    rows={8}
                    value={form.notesCustomer}
                    onChange={(event) => setForm({ ...form, notesCustomer: event.target.value })}
                  />
                </Field>
                <div className="releases-notes-preview-wrap">
                  <p className="label-sm">Preview</p>
                  {preview.length > 0 ? (
                    <ul className="releases-notes-preview">
                      {preview.map((line, index) => (
                        <li key={`${index}-${line}`}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="releases-notes-empty">Nothing to show yet.</p>
                  )}
                </div>
              </div>

              <Field label="Release body" help="Markdown for the GitHub release and notes page.">
                <Textarea
                  rows={6}
                  value={form.notesFullMd}
                  onChange={(event) => setForm({ ...form, notesFullMd: event.target.value })}
                />
              </Field>

              <Field label="Commit message" hint="required">
                <Input
                  value={form.commitMessage}
                  mono
                  onChange={(event) => setForm({ ...form, commitMessage: event.target.value })}
                />
              </Field>

              <div className="releases-editor-row">
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={form.mandatory}
                    onChange={(event) => setForm({ ...form, mandatory: event.target.checked })}
                  />
                  <span>
                    Mandatory
                    <small>The app installs this update without asking.</small>
                  </span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={form.prerelease}
                    onChange={(event) => setForm({ ...form, prerelease: event.target.checked })}
                  />
                  <span>
                    Prerelease
                    <small>Never written into update.xml.</small>
                  </span>
                </label>
              </div>

              <details
                className="releases-commits"
                onToggle={(event) => {
                  if (event.currentTarget.open) void openCommits();
                }}
              >
                <summary>Commits since {data.latestPublished?.tag ?? "the first commit"}</summary>
                {commitsError ? <FormError message={commitsError} /> : null}
                {commits ? (
                  <ul>
                    {commits.map((commit) => (
                      <li key={commit.sha}>
                        <span className="mono">{commit.shortSha}</span>
                        <span>{commit.subject}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </details>

              <FormError message={saveError} />

              <div className="row-actions releases-editor-actions">
                <Button
                  variant="primary"
                  icon={<Save />}
                  {...guard(writeBlock)}
                  disabled={saving || writeBlock !== null}
                  onClick={() => void save()}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  icon={<Hammer />}
                  {...guard(writeBlock ?? unsaved)}
                  onClick={() => startBuild()}
                >
                  Build installer
                </Button>
                <Button
                  icon={<Upload />}
                  {...guard(writeBlock ?? unsaved ?? notBuilt)}
                  onClick={() => startPublish()}
                >
                  Publish
                </Button>
              </div>

              <RunPanel detail={run.detail} error={run.error} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ──────────────────────────────── Workflows section ──────────────────────────────── */

function defaultInputs(workflow: WorkflowSummary): Record<string, string> {
  const values: Record<string, string> = {};
  for (const input of workflow.inputs) values[input.name] = input.default ?? "";
  return values;
}

function WorkflowField({
  spec,
  value,
  onChange,
}: {
  spec: WorkflowInputSpec;
  value: string;
  onChange: (next: string) => void;
}) {
  if (spec.type === "boolean") {
    return (
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(event) => onChange(event.target.checked ? "true" : "false")}
        />
        <span>
          {spec.name}
          {spec.description ? <small>{spec.description}</small> : null}
        </span>
      </label>
    );
  }
  if (spec.type === "choice" && spec.options && spec.options.length > 0) {
    return (
      <Field
        label={spec.name}
        hint={spec.required ? "required" : "optional"}
        help={spec.description}
      >
        <Select value={value} onValueChange={onChange} aria-label={spec.name}>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  return (
    <Field label={spec.name} hint={spec.required ? "required" : "optional"} help={spec.description}>
      <Input
        value={value}
        type={spec.type === "number" ? "number" : "text"}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

interface WorkflowsSectionProps {
  writeBlock: string | null;
  onConfirm: (spec: ConfirmSpec) => void;
  notify: (message: string) => void;
}

function WorkflowsSection({ writeBlock, onConfirm, notify }: WorkflowsSectionProps) {
  const { workflows, runs, loading, error, refresh } = useWorkflows(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [ref, setRef] = useState("");

  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? null;

  function select(workflow: WorkflowSummary) {
    setSelectedId(workflow.id);
    setValues(defaultInputs(workflow));
  }

  function startDispatch() {
    if (!selected) return;
    const workflow = selected;
    onConfirm({
      action: "dispatch",
      subject: String(workflow.id),
      title: `Run ${workflow.name}?`,
      confirmLabel: "Dispatch",
      run: async ({ token }) => {
        await dispatchWorkflow(workflow.id, {
          confirmToken: token,
          inputs: values,
          ref: ref.trim() || undefined,
        });
        notify(`${workflow.name} dispatched.`);
        refresh();
      },
    });
  }

  const workflowColumns: DataTableColumn<WorkflowSummary>[] = [
    { key: "name", header: "Workflow", minWidth: 180 },
    { key: "path", header: "File", mono: true, muted: true, minWidth: 200, maxWidth: 300 },
    { key: "state", header: "State", minWidth: 90 },
    {
      key: "actions",
      header: "",
      label: "Actions",
      minWidth: 120,
      render: (workflow) => (
        <div className="row-actions">
          <Button size="sm" icon={<PlayCircle />} onClick={() => select(workflow)}>
            Prepare
          </Button>
        </div>
      ),
    },
  ];

  const runColumns: DataTableColumn<WorkflowRunSummary>[] = [
    { key: "name", header: "Run", minWidth: 170 },
    {
      key: "status",
      header: "Result",
      minWidth: 110,
      render: (run) => <Badge tone={runTone(run)}>{runLabel(run)}</Badge>,
    },
    { key: "event", header: "Event", muted: true, minWidth: 120 },
    { key: "branch", header: "Branch", mono: true, minWidth: 110 },
    {
      key: "createdAt",
      header: "Started",
      minWidth: 120,
      render: (run) => <RelativeTime iso={run.createdAt} />,
    },
    {
      key: "link",
      header: "",
      label: "Link",
      minWidth: 90,
      render: (run) => (
        <a href={run.htmlUrl} target="_blank" rel="noreferrer noopener">
          GitHub <ExternalLink size={12} />
        </a>
      ),
    },
  ];

  return (
    <div className="page-stack-lg">
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Workflows</h2>
          </div>
          <Button size="sm" icon={<RefreshCw />} onClick={refresh}>
            Reload
          </Button>
        </div>
        <FormError message={error} />
        {loading && workflows.length === 0 ? (
          <div className="panel-body">
            <Skeleton width="100%" height={80} />
          </div>
        ) : workflows.length > 0 ? (
          <DataTable
            columns={workflowColumns}
            rows={workflows}
            rowKey={(workflow) => workflow.id}
            mobileLayout="stack"
            caption="Workflows declared in the repository"
          />
        ) : (
          <EmptyState icon={<WorkflowIcon />} title="No workflows">
            The repository declares no workflow the panel can read.
          </EmptyState>
        )}
      </section>

      {selected ? (
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <h2 className="section-title">Dispatch {selected.name}</h2>
              <p className="section-sub mono">{selected.path}</p>
            </div>
          </div>
          <div className="panel-body releases-editor-fields">
            <Field label="Ref" help="Branch or tag. Empty runs the default branch.">
              <Input value={ref} mono onChange={(event) => setRef(event.target.value)} />
            </Field>
            {selected.inputs.map((input) => (
              <WorkflowField
                key={input.name}
                spec={input}
                value={values[input.name] ?? ""}
                onChange={(next) => setValues((current) => ({ ...current, [input.name]: next }))}
              />
            ))}
            <div className="row-actions releases-editor-actions">
              <Button
                variant="primary"
                icon={<Send />}
                {...guard(writeBlock)}
                onClick={() => startDispatch()}
              >
                Dispatch
              </Button>
              <Button onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Recent runs</h2>
          </div>
        </div>
        {runs.length > 0 ? (
          <DataTable
            columns={runColumns}
            rows={runs}
            rowKey={(run) => run.id}
            mobileLayout="stack"
            caption="The most recent workflow runs"
          />
        ) : (
          <EmptyState icon={<Clock3 />} title="No runs yet">
            Nothing has run on this repository recently.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────────── Files section ────────────────────────────────── */

const WORKFLOWS_PREFIX = ".github/workflows/";

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

interface FilesSectionProps {
  writeBlock: string | null;
  onConfirm: (spec: ConfirmSpec) => void;
  notify: (message: string) => void;
}

function FilesSection({ writeBlock, onConfirm, notify }: FilesSectionProps) {
  const [path, setPath] = useState("");
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<RepoTreeEntry[]>([]);
  const [file, setFile] = useState<RepoFile | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");

  const open = useCallback(async (next: string) => {
    setLoading(true);
    setError(null);
    try {
      const payload: RepoPathResponse = await fetchRepoPath(next);
      setPath(payload.path);
      setPending(payload.path);
      if (payload.file) {
        setFile(payload.file);
        setContent(payload.file.content ?? "");
        setEntries([]);
        setMessage(`chore: update ${payload.file.path}`);
      } else {
        setFile(null);
        setContent("");
        setEntries(payload.entries ?? []);
      }
    } catch (cause) {
      setError(releasesErrorMessage(cause, "That path could not be opened."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void open("");
  }, [open]);

  function startCommit() {
    if (!file) return;
    const target = file;
    const isWorkflow = target.path.startsWith(WORKFLOWS_PREFIX);
    onConfirm({
      action: "commit",
      subject: target.path,
      title: `Commit ${target.path}?`,
      confirmLabel: "Commit",
      danger: isWorkflow,
      commitMessage: message,
      workflowsStep: isWorkflow,
      run: async ({ token, commitMessage, workflowsConfirm }) => {
        const result = await commitRepoFile({
          path: target.path,
          content,
          baseSha: target.sha,
          commitMessage,
          confirmToken: token,
          ...(isWorkflow ? { workflowsConfirm } : {}),
        });
        setFile({ ...target, sha: result.sha });
        notify(`${target.path} committed as ${result.commitSha.slice(0, 7)}.`);
      },
    });
  }

  const entryColumns: DataTableColumn<RepoTreeEntry>[] = [
    {
      key: "path",
      header: "Path",
      mono: true,
      minWidth: 220,
      render: (entry) => (
        <span className="releases-entry">
          {entry.type === "tree" ? <FolderOpen size={13} /> : <FileCode2 size={13} />}
          {entry.path.slice(path ? path.length + 1 : 0)}
        </span>
      ),
    },
    {
      key: "size",
      header: "Size",
      numeric: true,
      minWidth: 90,
      render: (entry) => <span>{entry.type === "tree" ? "—" : formatBytes(entry.size)}</span>,
    },
    {
      key: "actions",
      header: "",
      label: "Actions",
      minWidth: 100,
      render: (entry) => (
        <div className="row-actions">
          <Button
            size="sm"
            {...guard(
              entry.editable || entry.type === "tree" ? null : "This path is not editable.",
            )}
            onClick={() => void open(entry.path)}
          >
            Open
          </Button>
        </div>
      ),
    },
  ];

  const editRefusal =
    file && !file.editable ? (file.editRefusal ?? "This file is read-only.") : null;
  const unreadable = file?.unreadable ? "The panel cannot show this file's contents." : null;

  return (
    <div className="page-stack-lg">
      <PageToolbar
        aria-label="Repository path"
        search={
          <SearchInput
            value={pending}
            onChange={setPending}
            placeholder="Path on master, e.g. installer/RazorReaper.iss"
            aria-label="Repository path"
          />
        }
        filters={
          <>
            <Button size="sm" icon={<FolderOpen />} onClick={() => void open(pending.trim())}>
              Open
            </Button>
            <Button
              size="sm"
              icon={<ArrowLeft />}
              disabled={path === ""}
              onClick={() => void open(parentOf(path))}
            >
              Up
            </Button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">{path || "Repository root"}</h2>
          </div>
        </div>
        <FormError message={error} />
        {loading ? (
          <div className="panel-body">
            <Skeleton width="100%" height={80} />
          </div>
        ) : file ? (
          <div className="panel-body releases-editor-fields">
            {editRefusal ? (
              <div className="inline-notice" role="status">
                <ShieldAlert size={16} aria-hidden="true" />
                {editRefusal}
              </div>
            ) : null}
            {unreadable ? <FormError message={unreadable} /> : null}
            <Textarea
              className="releases-file-editor"
              rows={18}
              spellCheck={false}
              readOnly={!file.editable || Boolean(file.unreadable)}
              value={content}
              aria-label={`Contents of ${file.path}`}
              onChange={(event) => setContent(event.target.value)}
            />
            <Field label="Commit message" hint="required">
              <Input
                value={message}
                mono
                onChange={(event) => setMessage(event.target.value)}
                disabled={!file.editable}
              />
            </Field>
            <div className="row-actions releases-editor-actions">
              <Button
                variant="primary"
                icon={<FileCode2 />}
                {...guard(writeBlock ?? editRefusal ?? unreadable)}
                onClick={() => startCommit()}
              >
                Commit
              </Button>
              <Button onClick={() => void open(parentOf(file.path))}>Back to folder</Button>
            </div>
          </div>
        ) : entries.length > 0 ? (
          <DataTable
            columns={entryColumns}
            rows={entries}
            rowKey={(entry) => entry.path}
            mobileLayout="stack"
            caption="Files on master"
          />
        ) : (
          <EmptyState icon={<FolderOpen />} title="Nothing here">
            This path holds no file the panel can list.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────────── The page ─────────────────────────────────── */

function adoptionValue(data: ReleasesOverviewResponse): string {
  if (!data.adoption || data.adoption.totalInstalls === 0) return "—";
  return `${Math.round(data.adoption.share * 100)}%`;
}

function adoptionSub(data: ReleasesOverviewResponse): string {
  if (!data.adoption) return "No adoption data yet";
  const { installs, totalInstalls, windowDays } = data.adoption;
  return `${installs} of ${totalInstalls} installs · ${windowDays} days`;
}

function manifestSub(updateXml: UpdateXmlState | null): string {
  if (!updateXml) return "update.xml could not be read";
  return updateXml.pinnedTag
    ? `update.xml points at ${updateXml.pinnedTag}`
    : "update.xml points at no recognised tag";
}

export function ReleasesPage() {
  const { data, loading, error, refresh } = useReleases();
  const canEditFiles = usePanelPermission("releases.files");
  const [tab, setTab] = useState<ReleasesTab>("releases");
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 8000);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current !== undefined) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const token = data?.token ?? null;
  const writeBlock =
    token && !token.canWrite
      ? (token.message ??
        `Releases are read-only: ${token.source ?? "the GitHub token"} cannot write.`)
      : null;

  const tabs = useMemo<TabItem<ReleasesTab>[]>(() => {
    const items: TabItem<ReleasesTab>[] = [
      { key: "releases", label: "Releases", panelId: "releases-panel-releases" },
      { key: "drafts", label: "Drafts", panelId: "releases-panel-drafts" },
    ];
    // Absent, not disabled: a seat without releases.files never sees a commit box (decision 2).
    if (canEditFiles) {
      items.push({ key: "workflows", label: "Workflows", panelId: "releases-panel-workflows" });
      items.push({ key: "files", label: "Files", panelId: "releases-panel-files" });
    }
    return items;
  }, [canEditFiles]);

  const active = tabs.some((item) => item.key === tab) ? tab : "releases";

  const openDraft = useCallback((draft: ReleaseDraft) => {
    setForm(formFromDraft(draft));
    setTab("drafts");
  }, []);

  const latest = data?.latestPublished ?? null;
  const lastRun = data?.recentRuns[0] ?? null;
  const openDraftCount = data?.drafts.filter((draft) => draft.status !== "published").length ?? 0;
  const buildingDraft = data?.drafts.find((draft) => draft.status === "building") ?? null;

  return (
    <div className="page-content page-stack-lg releases-workspace">
      <PageHeader
        page="releases"
        right={
          <Button size="sm" icon={<RefreshCw />} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {writeBlock ? (
        <div className="inline-notice releases-token-line" role="status">
          <ShieldAlert size={16} aria-hidden="true" />
          {writeBlock}
        </div>
      ) : null}

      {data?.stale ? (
        <div className="inline-notice" role="status">
          <Clock3 size={16} aria-hidden="true" />
          GitHub was unreachable; this page is showing the last good read.
        </div>
      ) : null}

      {error ? (
        <div className="inline-notice danger" role="alert">
          {error}
          <Button size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}

      {notice ? (
        <div className="inline-notice" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="Latest published"
          value={latest ? latest.tag : "—"}
          sub={manifestSub(data?.updateXml ?? null)}
          icon={<Package size={14} />}
          loading={loading && !data}
        />
        <KpiStatCard
          label="Adoption of latest"
          value={data ? adoptionValue(data) : "—"}
          sub={data ? adoptionSub(data) : "Reading adoption…"}
          icon={<Users size={14} />}
          tone="primary"
          loading={loading && !data}
        />
        <KpiStatCard
          label="Draft"
          value={buildingDraft ? buildingDraft.tag : String(openDraftCount)}
          sub={
            buildingDraft
              ? `${DRAFT_LABEL[buildingDraft.status]} on the runner`
              : openDraftCount === 1
                ? "1 draft open"
                : `${openDraftCount} drafts open`
          }
          icon={<CircleDot size={14} />}
          loading={loading && !data}
        />
        <KpiStatCard
          label="Last build"
          value={runLabel(lastRun)}
          sub={lastRun ? `${lastRun.name} #${lastRun.runNumber}` : "No run recorded"}
          icon={<Hammer size={14} />}
          tone={runTone(lastRun) === "danger" ? "danger" : "primary"}
          loading={loading && !data}
        />
      </div>

      <Tabs aria-label="Release sections" items={tabs} value={active} onChange={setTab} />

      {!data ? (
        <section className="panel">
          <div className="panel-body">
            <Skeleton width="100%" height={120} />
          </div>
        </section>
      ) : (
        <div
          className="page-stack-lg"
          role="tabpanel"
          id={`releases-panel-${active}`}
          aria-labelledby={`releases-panel-${active}-tab`}
        >
          {active === "releases" ? (
            <ReleasesSection
              data={data}
              writeBlock={writeBlock}
              onConfirm={setConfirmSpec}
              onEditNotes={openDraft}
              refresh={refresh}
              notify={notify}
            />
          ) : null}
          {active === "drafts" ? (
            <DraftsSection
              data={data}
              writeBlock={writeBlock}
              onConfirm={setConfirmSpec}
              refresh={refresh}
              notify={notify}
              form={form}
              setForm={setForm}
            />
          ) : null}
          {active === "workflows" && canEditFiles ? (
            <WorkflowsSection writeBlock={writeBlock} onConfirm={setConfirmSpec} notify={notify} />
          ) : null}
          {active === "files" && canEditFiles ? (
            <FilesSection writeBlock={writeBlock} onConfirm={setConfirmSpec} notify={notify} />
          ) : null}
        </div>
      )}

      <ConfirmDialog spec={confirmSpec} onClose={() => setConfirmSpec(null)} />
    </div>
  );
}
