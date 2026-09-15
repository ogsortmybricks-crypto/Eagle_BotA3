import { useEffect, useState } from "react";
import { Redirect, Route, Switch, useRoute } from "wouter";
import { apiGet } from "@/lib/api";
import { applyPalette, useSession, type Palette } from "@/lib/session";
import { Layout } from "@/components/Layout";
import { LoadingPage } from "@/components/ui";
import { Setup } from "@/pages/Setup";
import { Login } from "@/pages/Login";
import { AcceptInvite } from "@/pages/AcceptInvite";
import { Wiki } from "@/pages/Wiki";
import { TownHall } from "@/pages/TownHall";
import { MeetingWorkspace } from "@/pages/MeetingWorkspace";
import { Elections } from "@/pages/Elections";
import { ElectionDetail } from "@/pages/ElectionDetail";
import { Positions } from "@/pages/Positions";
import { People, Profile } from "@/pages/People";
import { Admin } from "@/pages/Admin";
import { Settings } from "@/pages/Settings";
import { SimpleApp } from "@/pages/Simple";

type SetupStatus = {
  needsSetup: boolean;
  academy: { name: string; palette: Palette; logoUrl: string | null } | null;
};

export function App() {
  const { user, loading, settings, simpleMode } = useSession();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [inviteRoute, inviteParams] = useRoute("/invite/:token");

  useEffect(() => {
    apiGet<SetupStatus>("/setup/status")
      .then((data) => {
        setStatus(data);
        // Paint the academy's colours before sign-in too, so the login screen
        // already looks like the studio's.
        if (data.academy?.palette) applyPalette(data.academy.palette);
      })
      .catch(() => setStatus({ needsSetup: false, academy: null }));
  }, []);

  // The invite flow has to work while signed out and before anything else.
  if (inviteRoute && inviteParams?.token) {
    return <AcceptInvite token={inviteParams.token} />;
  }

  if (!status || loading) return <LoadingPage label="Starting up..." />;

  if (status.needsSetup) return <Setup />;

  if (!user) {
    return <Login academyName={status.academy?.name} logoUrl={status.academy?.logoUrl} />;
  }

  // A studio that asked for the simple view gets a different app, not the same
  // one with bits hidden - see the note at the top of Simple.tsx.
  if (simpleMode) return <SimpleApp />;

  return (
    <Layout>
      <Switch>
        {/* Which page you land on is an academy setting - a studio that lives
            in Town Hall shouldn't have to click past the wiki every morning. */}
        <Route path="/">{() => <Redirect to={`/${settings.display.startPage}`} />}</Route>
        <Route path="/wiki" component={Wiki} />
        <Route path="/town-hall" component={TownHall} />
        <Route path="/town-hall/:id">
          {(params) => <MeetingWorkspace id={Number(params.id)} />}
        </Route>
        <Route path="/elections" component={Elections} />
        <Route path="/elections/:id">{(params) => <ElectionDetail id={Number(params.id)} />}</Route>
        <Route path="/positions" component={Positions} />
        <Route path="/people" component={People} />
        <Route path="/people/:id">{(params) => <Profile id={Number(params.id)} />}</Route>
        <Route path="/admin" component={Admin} />
        <Route path="/settings" component={Settings} />
        <Route>
          {() => (
            <div className="card px-6 py-14 text-center">
              <h1 className="text-lg font-semibold text-gray-900">That page doesn't exist</h1>
              <p className="mt-1 text-sm text-gray-500">Check the address, or use the menu.</p>
            </div>
          )}
        </Route>
      </Switch>
    </Layout>
  );
}
