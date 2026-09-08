/**
 * One sign-out path for the whole console.
 *
 * The sidebar footer asked "Sign out?" first while Settings › Account signed out
 * on the spot, so the same words meant two different things two clicks apart.
 * Both controls now call `requestSignOut` from this hook and render its
 * `dialog`, which is the single confirm step.
 */
import { useState, type ReactNode } from "react";
import { Modal, ModalActions } from "../components/ds/Modal";
import { Button } from "../components/ds/Button";

export interface SignOut {
  /** Wire every sign-out control to this — it raises the confirm dialog. */
  requestSignOut: () => void;
  /** Render once in the caller's tree; it is null until the dialog is open. */
  dialog: ReactNode;
}

export function useSignOut(onLogout: () => void): SignOut {
  const [confirming, setConfirming] = useState(false);
  const close = () => setConfirming(false);
  return {
    requestSignOut: () => setConfirming(true),
    dialog: (
      <Modal
        open={confirming}
        onClose={close}
        title="Sign out?"
        sub="You will need to sign in again to access the panel."
      >
        <ModalActions>
          <Button variant="ghost" onClick={close}>
            Stay signed in
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              close();
              onLogout();
            }}
          >
            Sign out
          </Button>
        </ModalActions>
      </Modal>
    ),
  };
}
