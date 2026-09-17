/**
 * Release management — the page behind `#/releases` (docs/release-management-design.md §9).
 *
 * A stub on purpose: this change registers the page (PageKey, PAGE_META, the Administration rail
 * item, the lazy route) and the permission that gates it, so the route and the navigation can be
 * reviewed before the surface exists. The KPI row, the `Releases | Drafts | Workflows | Files`
 * tabs and the confirm modals arrive with the admin API they read from.
 */
import { Rocket } from "lucide-react";
import { EmptyState } from "../components/ds/EmptyState";
import { PageHeader } from "../components/ds/PageHeader";

export function ReleasesPage() {
  return (
    <div className="page-content page-stack-lg">
      <PageHeader page="releases" />
      <section className="panel">
        <EmptyState icon={<Rocket />} title="Under construction">
          Drafting, building and publishing a release moves into this page next.
        </EmptyState>
      </section>
    </div>
  );
}
