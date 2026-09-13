# RazorReaper admin design system

The admin panel shares RazorReaper's visual identity while giving customer and
support work a clear, compact structure. Preserve the existing logo, typography,
user-selected accent, theme preferences, and semantic status colors.

The customer directory and Customer 360 establish this system. Shared primitives
make the same patterns available to other operational pages.

## Visual foundation

- Use opaque charcoal surfaces for dark-theme work areas and neutral opaque
  surfaces for the light theme.
- Keep the existing network background in the surrounding shell. Content
  surfaces must remain legible over it.
- Use the selected accent for primary actions, active navigation, selection, and
  focus. Keep information surfaces and ordinary dividers neutral.
- Keep success, warning, error, and informational colors independent of the
  selected accent. Pair status color with a readable label.
- Use a 12px radius for outer record surfaces and 8px for controls. Keep borders
  thin and consistent.
- Add no decorative motion. Preserve reduced-motion behavior and existing
  interaction feedback.

## Typography

Retain the installed font roles and their existing tokens:

| Role      | Typeface       | Usage                                                                    |
| --------- | -------------- | ------------------------------------------------------------------------ |
| Display   | Space Grotesk  | Page titles and established display headings                             |
| Interface | Inter          | Body copy, controls, labels, and record information                      |
| Technical | JetBrains Mono | Identifiers and technical values that benefit from fixed-width alignment |

Customer identity leads the hierarchy. Display names and account context should
be visible before install identifiers, fingerprints, and diagnostic details.
Use the existing `--text-1`, `--text-2`, and `--text-3` tokens for text hierarchy.
Keep field labels and values above 12px, including on phones. Technical values
must wrap or truncate deliberately without expanding the workspace.

## Record tokens

The record surface tokens live in `src/theme/customer-system.css`. Scope theme
overrides through the existing light-theme selector.

| Token                    | Dark theme | Light theme | Purpose                             |
| ------------------------ | ---------- | ----------- | ----------------------------------- |
| `--record-surface`       | `#111216`  | `#ffffff`   | Main record and list surfaces       |
| `--record-surface-muted` | `#181a20`  | `#f4f5f8`   | Secondary and inset surfaces        |
| `--record-border`        | `#2c2f38`  | `#d9dde5`   | Surface boundaries                  |
| `--record-divider`       | `#23262e`  | `#e7e9ef`   | Internal row and section separators |
| `--record-radius`        | `12px`     | `12px`      | Outer surface radius                |
| `--record-gap`           | `16px`     | `16px`      | Record layout spacing               |
| `--record-padding`       | `18px`     | `18px`      | Default record surface padding      |

Use the existing text, font, accent, and status tokens alongside these record
tokens. The record system does not introduce a separate theme preference or
accent palette.

## Shared record components

`src/components/ds/RecordSection.tsx` provides the shared record building blocks.

### RecordSection

A section groups related record content within one surface. Its public content
slots are `title`, `description`, and `action`, followed by the section body.
Keep the title concise, use the description only when it explains the content,
and place a relevant section action beside the heading.

Avoid redundant headings and nested cards that repeat the same grouping. Use
dividers, spacing, and muted inset areas for subordinate content.

### RecordFacts

Use `RecordFacts` for a short, curated set of label/value pairs. Each item has a
`label`, `value`, and optional `mono` treatment. Labels describe the value in
language useful to an operator; monospace is appropriate for technical values.

Preserve explicit values such as zero and false. Show an intentional missing
value state instead of substituting a positive or healthy state. Long values
must remain readable within the available width.

## Customer directory

The directory workspace is scoped by `.customer-directory-workspace`.

- Keep the page heading and primary actions compact so useful records appear
  promptly below them.
- Put search and filters together in one toolbar inside the customer list
  surface. This is the single home for directory filtering.
- Omit a redundant `Directory` heading inside a page already titled Customers.
- Lead each customer entry with name, avatar or initials, and connected account
  context. Show device and license facts as supporting information.
- Keep active filter state, result state, selection, and row actions clearly
  associated with the list they affect.
- Preserve loading, empty, error, restricted-access, and pagination behavior.

Account identity, installations, and licenses describe different things. Keep
their labels explicit when they appear together; a device status should not
silently become an account status.

## Customer 360

The record workspace is scoped by `.customer-record-workspace`.

Start with a compact identity area containing customer name, account context,
and the actions the current operator may use. Follow it with the established
four-tab navigation. Preserve the tabs, permission gates, action behavior, and
existing history views.

Group customer information into readable sections using `RecordSection` and
`RecordFacts`. Environment details should be a curated set of available facts
that support diagnosis, such as app version, operating system, or relevant
hardware. Place detailed identifiers and diagnostic data below the main
customer context. Preserve access to existing technical detail and history.

Keep support history, activity, and administrative actions connected to the
customer they affect. State labels must communicate their actual scope, such
as account, installation, or license.

## Responsive behavior

On desktop, align facts and actions consistently and use compact section
spacing. Group related values into columns when there is sufficient width.

On phones:

- Use compact identity cards and stack supporting facts in reading order.
- Keep field text above 12px and touch actions at least 44px high.
- Allow the filter toolbar and action groups to wrap without horizontal page
  overflow.
- Keep the four Customer 360 tabs reachable and their active state obvious.
- Preserve the customer name and meaningful status labels when space is tight.
- Wrap long identifiers or use an intentional truncated presentation with the
  existing means of accessing the complete value.

## Styling boundaries

Import `src/theme/customer-system.css` last in `src/main.tsx`, after the existing
theme and component styles. It styles shared record primitives and the scoped
customer workspaces.

Keep page-specific overrides under `.customer-directory-workspace` or
`.customer-record-workspace`. Shared record classes may be reused elsewhere,
but broad element selectors must not restyle unrelated pages. Use the shared
tokens and components when extending the system, and keep data retrieval,
permissions, and operational behavior in their existing owners.
