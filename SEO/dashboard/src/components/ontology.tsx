import { createContext, useContext } from 'react';

// The lifecycles the API runs on (GET /api/ontology), already localized by the server.
export interface OntologyTransition {
  id: string;
  from: string;
  to: string;
  actionApiName: string;
  actionLabel: string;
}

export interface OntologyLifecycle {
  initial: string;
  states: string[];
  terminal: string[];
  transitions: OntologyTransition[];
}

export interface OntologyView {
  packageId: string;
  version: string;
  counts: Record<string, number>;
  lifecycles: Record<'anomaly' | 'cause' | 'countermeasure', OntologyLifecycle>;
}

export const OntologyContext = createContext<OntologyView | null>(null);

export function useOntology() {
  return useContext(OntologyContext);
}

/** Transitions the ontology allows from `state` for an entity. */
export function useNextTransitions(entity: 'anomaly' | 'cause' | 'countermeasure', state: string): OntologyTransition[] {
  const o = useOntology();
  return o ? o.lifecycles[entity].transitions.filter((t) => t.from === state) : [];
}
