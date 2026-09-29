import { createHash, randomUUID } from 'node:crypto';
import type { BandRole } from '@thermaldesk/coordination';
import type { CaseState, Recommendation } from './model';
import type { CaseStore } from './store';

export interface SupplierQuote {
  id: string; part_id: string; offered_part_id: string; specification: string; supplier: string;
  quantity: number; total_minor: number; currency: string; source_url: string;
  valid_until: string; delivery_at: string; recorded_by: string; recorded_at: string;
}
export interface Contact { id: string; name: string; email: string; qualifications: string[]; site_id: string; recorded_by: string }
export interface PreparationState {
  scope_key: string; quotes: SupplierQuote[]; contacts: Contact[];
  budget: { total_minor: number; currency: string; recorded_by: string } | null;
  history: { id: string; at: string; role: BandRole; summary: string }[];
}
export type PreparationCommand = { command: 'prepare' | 'quote' | 'budget' | 'contact'; expectedRevision: number; values?: Record<string, unknown> };
const keyOf = (rec: Recommendation) => createHash('sha256').update(JSON.stringify([rec.recommendation_id, rec.version, rec.repair_scope, rec.parts, rec.approval])).digest('hex');
const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const text = (value: unknown, name: string, max = 1000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`${name} is required and must fit on one line.`);
  return value.trim();
};
const money = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000_00) throw new Error('Amount must be non-negative integer cents within the supported limit.');
  return Number(value);
};
const currency = (value: unknown) => { const result = text(value, 'Currency', 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(result)) throw new Error('Use a three-letter currency.'); return result; };
const date = (value: unknown, name: string) => {
  const result = text(value, name, 40);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error(`${name} needs an ISO date with a timezone.`);
  return new Date(result).toISOString();
};
function approved(state: CaseState) {
  const rec = state.recommendation;
  if (!rec || rec.status !== 'approved' || rec.approval?.recommendation_version !== rec.version) throw new Error('Review and approve the exact repair scope before preparing supplier or technician requests.');
  return rec;
}
function prepFor(state: CaseState, rec: Recommendation): PreparationState {
  return state.preparation?.scope_key === keyOf(rec) ? state.preparation : { scope_key: keyOf(rec), quotes: [], contacts: [], budget: null, history: [] };
}
export function supplierLinks(partNumber: string) {
  const query = encodeURIComponent(partNumber);
  return [
    { name: 'Grainger', url: `https://www.grainger.com/search?searchQuery=${query}` },
    { name: 'DigiKey', url: `https://www.digikey.com/en/products/result?keywords=${query}` },
    { name: 'McMaster-Carr catalog', url: 'https://www.mcmaster.com/products/electrical/' },
  ];
}
export function preparationDispatchKey(state: CaseState) {
  const rec = approved(state), prep = prepFor(state, rec);
  return createHash('sha256').update(JSON.stringify([prep.scope_key, prep.quotes, prep.contacts, prep.budget])).digest('hex');
}
export function preparationView(state: CaseState) {
  const rec = state.recommendation;
  const ready = Boolean(rec && rec.status === 'approved' && rec.approval?.recommendation_version === rec.version);
  if (!rec) return { revision: state.revision, ready: false, message: 'Upload evidence and obtain a reviewed repair scope first.', parts: [], quotes: [], contacts: [], history: [], budget: null, selected_total_minor: null, selection_complete: false, draft_only: true };
  const prep = prepFor(state, rec);
  const quotes = prep.quotes.map(quote => {
    const part = rec.parts.find(part => part.part_id === quote.part_id);
    const failures: string[] = [];
    if (!ready) failures.push('Current recommendation is not approved.');
    if (!part || quote.offered_part_id !== part.part_id || norm(quote.specification) !== norm(part.approved_specification)) failures.push('Part number or specification differs from the approved scope.');
    if (part?.requires_specification_review) failures.push('Part specification still requires technical review.');
    if (part && quote.quantity !== part.quantity) failures.push('Quoted quantity does not match the approved quantity.');
    if (Date.parse(quote.valid_until) <= Date.now()) failures.push('Quote has expired.');
    if (Date.parse(quote.delivery_at) < Date.now()) failures.push('Delivery estimate needs refreshing.');
    if (!prep.budget) failures.push('No planning budget has been entered.');
    else {
      if (quote.currency !== prep.budget.currency) failures.push('Currency differs from the planning budget.');
      if (quote.total_minor > prep.budget.total_minor) failures.push('Quote exceeds the planning budget.');
    }
    return { ...quote, provenance: 'operator_entered' as const, status: failures.length ? 'blocked' : 'eligible_for_review', failures };
  });
  const parts = rec.parts.map(part => ({ ...part, links: supplierLinks(part.part_id),
    fictional: /DEMO|fictional|training prop/i.test(`${part.part_id} ${part.approved_specification}`),
    selected_quote_id: quotes.filter(quote => quote.part_id === part.part_id && !quote.failures.length).sort((a, b) => a.total_minor - b.total_minor || a.id.localeCompare(b.id))[0]?.id ?? null }));
  const selected = parts.map(part => quotes.find(quote => quote.id === part.selected_quote_id)).filter((quote): quote is typeof quotes[number] => Boolean(quote));
  const total = selected.reduce((sum, quote) => sum + quote.total_minor, 0);
  const complete = selected.length === parts.length && Boolean(prep.budget) && total <= prep.budget!.total_minor;
  return { revision: state.revision, ready, message: ready ? 'Supplier research and email drafts only. No order, message or booking is confirmed.' : 'Approve the current scope to prepare drafts.',
    recommendation_id: rec.recommendation_id, recommendation_version: rec.version, synthetic_approval: Boolean(rec.approval && rec.approval.mode !== 'live'),
    parts, quotes, contacts: prep.contacts, budget: prep.budget, history: prep.history,
    selected_total_minor: selected.length ? total : null, selection_complete: complete,
    selection_issue: prep.budget && total > prep.budget.total_minor ? 'Combined selected quotes exceed the planning budget.' : selected.length !== parts.length ? 'A matching, current quote is needed for each part.' : null,
    draft_only: true };
}

export class RepairPreparation {
  constructor(readonly store: CaseStore) {}
  async read() { return preparationView(await this.store.read()); }
  async command(input: PreparationCommand) {
    return this.store.update(async state => {
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== state.revision) throw new Error('Case changed. Refresh before saving.');
      const rec = approved(state), prep = prepFor(state, rec), v = input.values ?? {};
      if (input.command === 'quote') {
        const source = new URL(text(v.source_url, 'Supplier product or quote URL', 2000));
        if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Use a public HTTPS supplier product or quote URL without credentials.');
        const partId = text(v.part_id, 'Approved part number', 120);
        if (!rec.parts.some(part => part.part_id === partId)) throw new Error('This part is not in the approved scope.');
        const quantity = Number(v.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quote quantity must be positive.');
        prep.quotes.push({ id: randomUUID(), part_id: partId, offered_part_id: text(v.offered_part_id, 'Offered part number', 120),
          specification: text(v.specification, 'Supplier specification'), supplier: text(v.supplier, 'Supplier', 120),
          quantity, total_minor: money(v.total_minor), currency: currency(v.currency), source_url: source.href,
          valid_until: date(v.valid_until, 'Quote expiry'), delivery_at: date(v.delivery_at, 'Delivery estimate'),
          recorded_by: text(v.recorded_by, 'Recorded by', 100), recorded_at: new Date().toISOString() });
      } else if (input.command === 'budget') {
        prep.budget = { total_minor: money(v.total_minor), currency: currency(v.currency), recorded_by: text(v.recorded_by, 'Budget reviewer', 100) };
      } else if (input.command === 'contact') {
        const email = text(v.email, 'Email', 254);
        if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) throw new Error('Enter one valid technician email address.');
        const contact = { id: randomUUID(), name: text(v.name, 'Technician name', 100), email,
          qualifications: text(v.qualifications, 'Verified qualifications', 500).split(',').map(item => item.trim()).filter(Boolean),
          site_id: rec.site_id, recorded_by: text(v.recorded_by, 'Roster reviewer', 100) };
        if (prep.contacts.some(item => item.email.toLowerCase() === email.toLowerCase())) throw new Error('This technician is already in the roster.');
        prep.contacts.push(contact);
      } else if (input.command !== 'prepare') throw new Error('Unknown preparation command.');
      state.preparation = prep;
      this.recordRoles(state);
      state.revision++;
      return { state, result: preparationView(state) };
    });
  }
  private recordRoles(state: CaseState, role?: BandRole) {
    const view = preparationView(state);
    const summaries: Record<BandRole, string> = {
      RepairCoordinator: `Preparing reviewed recommendation ${state.recommendation!.recommendation_id} v${state.recommendation!.version}.`,
      PartsSourcer: `${view.parts.length} approved part(s): supplier search links and RFQ email drafts available. ${view.quotes.length} operator-entered quote(s); no supplier price was invented.\n${view.parts.map(part => `${part.part_id}: ${part.quantity} ${part.unit}; ${part.links.map(link => `${link.name}: ${link.url}`).join('; ')}`).join('\n')}`,
      AuthorityCritic: `${view.quotes.filter(quote => quote.status === 'eligible_for_review').length} quote(s) eligible for review; ${view.quotes.filter(quote => quote.status === 'blocked').length} blocked. ${view.selection_complete ? 'Selected total fits the planning budget.' : 'A complete, affordable selection is still needed.'} No purchasing authorization granted.\n${view.quotes.map(quote => `${quote.supplier} / ${quote.offered_part_id}: ${(quote.total_minor / 100).toFixed(2)} ${quote.currency} — ${quote.failures.join('; ') || 'eligible for human review'}`).join('\n')}`,
      TechDispatcher: `${view.contacts.length} customer-entered technician contact(s). Availability-request drafts prepared; no emails sent or appointments confirmed.`,
      ScheduleReporter: 'Preparation saved. No order, booking or manager notification occurred. The execution workbook is unchanged by preparation.',
    };
    for (const name of role ? [role] : Object.keys(summaries) as BandRole[]) {
      state.preparation!.history.push({ id: randomUUID(), at: new Date().toISOString(), role: name, summary: summaries[name] });
    }
    state.preparation!.history = state.preparation!.history.slice(-100);
    return role ? summaries[role] : '';
  }
  async runRole(jobId: string, role: BandRole) {
    return this.store.update(async state => {
      if (state.job?.job_id !== jobId) throw new Error('Band preparation is limited to the current app job.');
      const rec = approved(state); state.preparation = prepFor(state, rec);
      const summary = this.recordRoles(state, role); state.revision++;
      return { state, result: summary };
    });
  }
  async draft(kind: string, id: string) {
    const state = await this.store.read(), rec = approved(state), prep = prepFor(state, rec);
    const demo = rec.approval!.mode !== 'live' ? 'DEMONSTRATION SCOPE — not real repair authority.\n\n' : '';
    let to = '', subject = '', body = '';
    if (kind === 'rfq') {
      const part = rec.parts.find(part => part.part_id === id);
      if (!part) throw new Error('Part is not in the current approved scope.');
      subject = `Request for quotation: ${part.part_id}`;
      body = `${demo}Please quote the following exact part; do not substitute without review.\n\nPart: ${part.part_id}\nSpecification: ${part.approved_specification}\nQuantity: ${part.quantity} ${part.unit}\n\nPlease provide total pricing including freight/tax, currency, available quantity, delivery estimate, quotation reference and expiry.\n\nCase: ${rec.case_id}\nAsset: ${rec.asset_id}\nReviewed scope: ${rec.recommendation_id} version ${rec.version}\n\nThis is an information request, not a purchase order. No order is authorized by this email.`;
    } else if (kind === 'technician') {
      const person = prep.contacts.find(person => person.id === id);
      if (!person) throw new Error('Technician is not in the current customer-entered roster.');
      to = person.email; subject = `Availability enquiry: ${rec.asset_id}`;
      body = `${demo}Hello ${person.name},\n\nPlease advise your availability, qualifications for this specific scope, and service quotation.\n\nSite: ${rec.site_id}\nAsset: ${rec.asset_id}\nReviewed scope: ${rec.recommendation_id} version ${rec.version}\n${rec.repair_scope}\n\nParts and delivery have not been confirmed. Please do not attend, begin work or treat this enquiry as a booking. Any appointment needs a separate confirmation after the parts and authority are verified.`;
    } else throw new Error('Unknown draft type.');
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
    return ['X-Unsent: 1', `To: ${to}`, `Subject: ${encodedSubject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(body).toString('base64').match(/.{1,76}/g)!.join('\r\n'), ''].join('\r\n');
  }
}
