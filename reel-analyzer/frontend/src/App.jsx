import { Link, useLocation } from "./lib/router.jsx";
import Home from "./pages/Home.jsx";
import Library from "./pages/Library.jsx";
import Reel from "./pages/Reel.jsx";
import { IconLibrary, IconSpark } from "./components/Icons.jsx";

function NavItem({ to, active, icon, label }) {
  return (
    <Link
      to={to}
      className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium sm:flex-none sm:flex-row sm:gap-2 sm:rounded-xl sm:px-3 sm:text-sm ${
        active ? "text-brand-600 dark:text-brand-500 sm:bg-brand-50 dark:sm:bg-brand-500/10" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function App() {
  const { path } = useLocation();
  const reelMatch = path.match(/^\/reel\/([\w-]+)/);
  let page;
  if (reelMatch) page = <Reel key={reelMatch[1]} id={reelMatch[1]} />;
  else if (path.startsWith("/library")) page = <Library />;
  else page = <Home />;

  const nav = (
    <>
      <NavItem to="/" active={path === "/"} icon={<IconSpark />} label="Analyze" />
      <NavItem to="/library" active={path.startsWith("/library")} icon={<IconLibrary />} label="Library" />
    </>
  );

  return (
    <div className="min-h-dvh pb-20 sm:pb-0">
      <header className="no-print sticky top-0 z-20 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            Reel Analyzer
          </Link>
          <nav className="hidden gap-1 sm:flex">{nav}</nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{page}</main>
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-20 flex border-t border-zinc-200 bg-white/95 backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {nav}
      </nav>
    </div>
  );
}
