export type FeedbackStatus = "new" | "read" | "archived";
export function matchesFeedbackStatus(status: FeedbackStatus, view: "all" | FeedbackStatus) {
  return view === "all" ? status !== "archived" : status === view;
}
