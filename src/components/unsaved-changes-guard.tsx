import { useBlocker } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Render inside a form that holds edits locally until an explicit Save.
 * While `when` is true it intercepts in-app navigation — including a
 * search-param-only change such as switching Settings tabs, which unmounts
 * the form — with a confirm dialog, and asks the browser to warn on
 * refresh/close. Renders nothing visible otherwise.
 */
export function UnsavedChangesGuard({ when }: { when: boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: !when,
    enableBeforeUnload: when,
    withResolver: true,
  });

  return (
    <AlertDialog
      open={blocker.status === "blocked"}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            You have changes here that haven't been saved. If you leave now, they'll be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {/* Cancel and Esc both close via onOpenChange above → reset(). */}
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Don't let Radix close the dialog itself — that would fire
              // onOpenChange(false) → reset() right after proceed(). The
              // dialog closes on its own once the blocker goes idle.
              e.preventDefault();
              blocker.proceed?.();
            }}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
