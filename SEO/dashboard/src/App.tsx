import { useEffect, useState } from 'react';
import { AppSidebar } from './components/AppSidebar.tsx';
import { Header, TopBar } from './components/Header.tsx';
import { PageTabs, type PageKey } from './components/PageTabs.tsx';
import { EmptyState } from './components/States.tsx';
import { ToastProvider } from './components/Toast.tsx';
import { OntologyContext, type OntologyView } from './components/ontology.tsx';
import { useApi } from './components/useApi.ts';
import { DataPage } from './pages/Data.tsx';
import { DataImportPage } from './pages/DataImport.tsx';
import { MeasurementsPage } from './pages/Measurements.tsx';
import { ReportPage } from './pages/Report.tsx';
import { readLang, setLang, t, type Lang } from './i18n.ts';
import { contextQuery, parseContext, type ImportContext } from './context.ts';

const PAGES: Record<PageKey, { title: string; subtitle: string }> = {
  import: { title: 'Data Import', subtitle: 'Receive SEO data · check and standardize' },
  data: { title: 'Data', subtitle: 'SEO performance analysis · current vs previous period' },
  measurements: { title: 'Measurements', subtitle: 'Client judgment rules · OK / NG · anomalies' },
  report: { title: 'Report', subtitle: 'Final SEO analysis · anomalies · causes · countermeasures' },
};

type Route = { app: 'seo'; page: PageKey; ctx: ImportContext } | { app: null };

// #/seo/<page>?uploads=<ids>&end=<date>&run=<id>: an empty hash opens the SEO workbench (the only application).
// The query is the active import context (files + period + run) that Data, Measurements and Report follow.
function parseHash(): Route {
  const [path, search] = window.location.hash.replace(/^#\/?/, '').split('?');
  const [app, page] = (path ?? '').split('/');
  if (app === 'home') return { app: null };
  const ctx = parseContext(new URLSearchParams(search ?? ''));
  return { app: 'seo', page: page === 'data' || page === 'measurements' || page === 'report' ? page : 'import', ctx };
}

const EMPTY: ImportContext = { uploads: [] };

export function App() {
  const [lang, setLangState] = useState<Lang>(readLang);
  setLang(lang); // before children render, so t() uses it
  const [route, setRoute] = useState<Route>(parseHash);
  const [lastPage, setLastPage] = useState<PageKey>(route.app === 'seo' ? route.page : 'import');
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (route.app === 'seo') setLastPage(route.page);
  }, [route]);
  const ctx = route.app === 'seo' ? route.ctx : EMPTY;
  /** Opens a page; the active context goes with it unless a new one is given. */
  const go = (p: PageKey, next: ImportContext = ctx) => (window.location.hash = `/seo/${p}${contextQuery(next)}`);
  /** Updates the context on the current page (period override, derived period, run). No new history entry. */
  const setCtx = (patch: Partial<ImportContext>) => {
    if (route.app !== 'seo') return;
    const url = `#/seo/${route.page}${contextQuery({ ...ctx, ...patch })}`;
    if (url !== window.location.hash) (history.replaceState(null, '', url), setRoute(parseHash()));
  };
  // Lifecycles and labels come from the LOGOS SEO ontology the API runs on.
  const ontology = useApi<OntologyView>('/ontology');
  // Sidebar as a drawer on small screens.
  const [navOpen, setNavOpen] = useState(false);

  return (
    <OntologyContext.Provider value={ontology.data}>
    <ToastProvider>
    <div className="app">
      <TopBar lang={lang} onLang={setLangState} onMenu={() => setNavOpen((o) => !o)} />
      <div className="layout">
        <AppSidebar active={route.app === 'seo'} onOpen={() => go(lastPage)} open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="workspace">
          {route.app === 'seo' ? (
            <>
              <Header title={t(PAGES[route.page].title)} subtitle={t(PAGES[route.page].subtitle)} nav={<PageTabs active={route.page} onNavigate={(p) => go(p)} />} />
              <main className="content">
                {route.page === 'import' && <DataImportPage onContinue={(uploads) => go('data', { uploads })} />}
                {route.page === 'data' && (
                  <DataPage key={ctx.uploads.join(',') || 'all'} ctx={ctx} onCtx={setCtx} onShowAll={() => go('data', EMPTY)} onContinue={() => go('measurements')} />
                )}
                {route.page === 'measurements' && <MeasurementsPage ctx={ctx} onCtx={setCtx} onContinue={(run) => go('report', { ...ctx, run })} />}
                {route.page === 'report' && <ReportPage ctx={ctx} onCtx={setCtx} onBack={() => go('measurements')} />}
              </main>
            </>
          ) : (
            <main className="content">
              <EmptyState title={t('Select an application')}>{t('Choose SEO in the sidebar to open the workbench.')}</EmptyState>
            </main>
          )}
        </div>
      </div>
    </div>
    </ToastProvider>
    </OntologyContext.Provider>
  );
}
