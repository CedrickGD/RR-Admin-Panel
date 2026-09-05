import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserRollupRecord } from "../types/telemetry";
import { apiUrl } from "../utils/api";
import { PanelIdentity, usePanelPermission } from "../hooks/usePanelPermission";

export interface CustomerProfile {
  id: string;
  installId: string;
  hwid: string | null;
  displayName: string;
  discordId: string;
  discordUsername: string;
  avatar: string | null;
}
const Profiles = createContext<CustomerProfile[]>([]);
export function CustomerProfilesProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const user = useContext(PanelIdentity);
  const customers = usePanelPermission("customers.read"),
    monitoring = usePanelPermission("monitoring.read");
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    setProfiles([]);
    const refresh = async () => {
      if (pending || document.hidden || (!customers && !monitoring)) return;
      pending = true;
      try {
        const response = await fetch(apiUrl("/api/admin/customer-profiles"), {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!controller.signal.aborted && data.ok && Array.isArray(data.profiles))
          setProfiles(data.profiles);
      } catch {
        /* Existing device labels remain usable if profiles are temporarily unavailable. */
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [user?.email, customers, monitoring]);
  return <Profiles.Provider value={profiles}>{children}</Profiles.Provider>;
}
export function useCustomerProfiles() {
  const profiles = useContext(Profiles);
  return useCallback(
    (installId?: string | null, hwid?: string | null) =>
      profiles.find((profile) => installId && profile.installId === installId) ??
      profiles.find((profile) => hwid && profile.hwid?.toLowerCase() === hwid.toLowerCase()),
    [profiles],
  );
}
export function useCustomerDirectory(source: UserRollupRecord[] | null) {
  const find = useCustomerProfiles();
  return useMemo(
    () =>
      source?.map((user) => {
        const profile = find(user.identity, user.hwid);
        return profile
          ? { ...user, userLabel: profile.displayName, discordUser: profile.discordUsername }
          : user;
      }) ?? null,
    [source, find],
  );
}
export function CustomerAvatar({ profile, label }: { profile?: CustomerProfile; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile?.avatar]);
  const avatar = profile?.avatar;
  return (
    <span className="person-avatar">
      {avatar && !failed ? (
        <img
          src={apiUrl(avatar)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        (profile?.displayName || label).slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
