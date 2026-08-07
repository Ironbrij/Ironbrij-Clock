import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-store";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — IronTrack" },
      {
        name: "description",
        content: "Sign in to IronTrack, the internal time tracking workspace for Ironbrij teams.",
      },
      { property: "og:title", content: "Sign in — IronTrack" },
      { property: "og:description", content: "Internal time tracking for Ironbrij teams." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { session, authLoading } = useWorkspace();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"password" | "google" | null>(null);

  useEffect(() => {
    if (session) navigate({ to: "/", replace: true });
  }, [session, navigate]);

  // Google sign-in redirects away and back through Supabase's own
  // callback. If the "Before User Created" hook rejected an uninvited
  // signup, Supabase sends the reason back as an error in the URL
  // (search params on some flows, a hash fragment on others) rather than
  // as a normal JS error we could catch inline — so it has to be picked
  // up here, once the page remounts after the redirect.
  useEffect(() => {
    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.search;
    const params = new URLSearchParams(raw);
    const description = params.get("error_description") || params.get("error");
    if (description) {
      toast.error("Couldn't sign you in", { description: description.replace(/\+/g, " ") });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const signInWithPassword = async () => {
    setBusy("password");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(null);
    if (error) {
      toast.error("Couldn't sign you in", { description: error.message });
      return;
    }
    navigate({ to: "/", replace: true });
  };

  const signInWithGoogle = async () => {
    setBusy("google");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) {
      setBusy(null);
      toast.error("Google sign-in failed", { description: "Please try again in a moment." });
    }
    // Nothing else runs here on success — the browser leaves for Google and
    // comes back through Supabase's own callback, remounting this component
    // with a session already set (or an error in the URL — see the effect
    // above). Whether the account is actually allowed to exist at all is
    // now enforced server-side, before it's ever created.
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/ironbrij-mark.png" alt="IronTrack" className="h-14 w-14" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to IronTrack and pick up where you left off.
          </p>
        </div>
        <Card className="shadow-elevated">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="grid gap-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@ironbrij.com"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && signInWithPassword()}
              />
            </div>
            <Button
              className="w-full gap-2"
              disabled={busy !== null || authLoading}
              onClick={signInWithPassword}
            >
              {busy === "password" && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={busy !== null}
              onClick={signInWithGoogle}
            >
              {busy === "google" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.7l4-3Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z"
                  />
                </svg>
              )}
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Internal tool for Ironbrij staff — accounts are created by invite only. Trouble getting
          in? Ping People &amp; Culture.
        </p>
      </div>
    </main>
  );
}
