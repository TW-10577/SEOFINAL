import { useEffect, useState } from 'react';
import { AppSidebar } from './components/AppSidebar.tsx';
import { Header, TopBar } from './components/Header.tsx';
import { PageTabs, type PageKey } from './components/PageTabs.tsx';
import { EmptyState } from './components/States.tsx';
import { OntologyContext, type OntologyView } from './components/ontology.tsx';
import { useApi } from './components/useApi.ts';
import { DataPage } from './pages/Data.tsx';
import { DataImportPage } from './pages/DataImport.tsx';
import { MeasurementsPage } from './pages/Measurements.tsx';
import { readLang, setLang, t, type Lang } from './i18n.ts';

const PAGES: Record<PageKey, { title: string; subtitle: string }> = {
  import: { title: 'Data Import', subtitle: 'Receive SEO data · check and standardize' },
  data: { title: 'Data', subtitle: 'SEO performance analysis · current vs previous period' },
  measurements: { title: 'Measurements', subtitle: 'Client judgment rules · anomalies · causes · countermeasures · report' },
};

type Route = { app: 'seo'; page: PageKey } | { app: null };

// #/seo/<page>; an empty hash opens the SEO workbench (the only application).
function parseHash(): Route {
  const [app, page] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (app === 'home') return { app: null };
  return { app: 'seo', page: page === 'data' || page === 'measurements' ? page : 'import' };
}

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
  const go = (p: PageKey) => (window.location.hash = `/seo/${p}`);
  // Lifecycles and labels come from the LOGOS SEO ontology the API runs on.
  const ontology = useApi<OntologyView>('/ontology');

  return (
    <OntologyContext.Provider value={ontology.data}>
    <div className="app">
      <TopBar lang={lang} onLang={setLangState} />
      <div className="layout">
        <AppSidebar active={route.app === 'seo'} onOpen={() => go(lastPage)} ontology={ontology.data} />
        <div className="workspace">
          {route.app === 'seo' ? (
            <>
              <Header title={t(PAGES[route.page].title)} subtitle={t(PAGES[route.page].subtitle)} nav={<PageTabs active={route.page} onNavigate={go} />} />
              <main className="content">
                {route.page === 'import' && <DataImportPage onContinue={() => go('data')} />}
                {route.page === 'data' && <DataPage onContinue={() => go('measurements')} />}
                {route.page === 'measurements' && <MeasurementsPage />}
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
    </OntologyContext.Provider>
  );
}
