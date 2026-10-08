import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowRight, Box, Check, FileClock, FileText,
  LayoutDashboard, LifeBuoy, MapPin, PackagePlus, Search, Settings, ShieldCheck, Truck, Users, X,
} from 'lucide-react';
import {
  Route, Switch, Link, Redirect, useLocation, Router as WouterRouter,
} from 'wouter';
import {
  useCreateContact, useCreateQuote, useCreateShipment, useCreateTrackingEvent,
  useGetAdminAuditLogs, useGetAdminContacts, useGetAdminCustomers, useGetAdminDashboard,
  useGetAdminQuotes, useGetAdminShipment, useGetAdminShipments, useGetAdminUsers,
  useGetCurrentUser, useGetCustomerNotifications, useGetCustomerQuotes,
  useGetCustomerShipments, useGetPublicTracking, useGetSiteSettings, useHealthCheck,
  useMarkNotificationRead, useSyncShipmentTracking, useUpdateContact, useUpdateCurrentUser,
  useUpdateQuote, useUpdateShipment, useUpdateSiteSettings, useUpdateUserRole,
  getGetAdminContactsQueryKey,
  getGetAdminDashboardQueryKey, getGetAdminQuotesQueryKey, getGetAdminShipmentQueryKey,
  getGetAdminShipmentsQueryKey, getGetAdminUsersQueryKey, getGetCurrentUserQueryKey,
  getGetCustomerNotificationsQueryKey, getGetPublicTrackingQueryKey, getGetSiteSettingsQueryKey,
  setAuthTokenGetter,
} from '@workspace/api-client-react';
import type {
  Contact, Quote, Shipment, SiteSettingsUpdate, TrackingEventInput,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const TrackingMap = lazy(() => import('@/components/tracking-map').then(module => ({ default: module.TrackingMap })));
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.png`,
  },
  variables: {
    colorPrimary: '#213a50', colorForeground: '#263d4e', colorMutedForeground: '#6d7a80',
    colorDanger: '#a74c3c', colorBackground: '#fffdf8', colorInput: '#fbf8f2',
    colorInputForeground: '#263d4e', colorNeutral: '#ddd6ca', fontFamily: 'DM Sans',
    borderRadius: '0.55rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fffdf8] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#e3ddd2]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#213a50] font-bold',
    headerSubtitle: 'text-[#68777d]',
    socialButtonsBlockButtonText: 'text-[#304958] font-semibold',
    formFieldLabel: 'text-[#354c59] font-semibold',
    footerActionLink: 'text-[#ad6044] font-semibold',
    footerActionText: 'text-[#68777d]',
    dividerText: 'text-[#778187]',
    identityPreviewEditButton: 'text-[#ad6044]',
    formFieldSuccessText: 'text-[#3f7051]',
    alertText: 'text-[#8b4034]',
    logoBox: 'rounded-lg',
    logoImage: 'object-contain',
    socialButtonsBlockButton: 'border-[#ddd6ca] bg-[#fbf8f2] hover:bg-[#f3eee5]',
    formButtonPrimary: 'bg-[#213a50] hover:bg-[#2c4b64] text-[#fffdf8]',
    formFieldInput: 'border-[#ddd6ca] bg-[#fbf8f2] text-[#263d4e]',
    footerAction: 'border-t border-[#e7e1d8]',
    dividerLine: 'bg-[#e2dbd0]',
    alert: 'border-[#e8c5bd] bg-[#fbefec]',
    otpCodeFieldInput: 'border-[#ddd6ca] bg-[#fbf8f2]',
    formFieldRow: 'gap-1',
    main: 'gap-5',
  },
};

type IconType = typeof Truck;
const serviceLinks = [
  { slug: 'air-freight', title: 'Air freight', description: 'Time-sensitive cargo, planned with clarity.' },
  { slug: 'ocean-freight', title: 'Ocean freight', description: 'Flexible container and less-than-container options.' },
  { slug: 'road-freight', title: 'Road freight', description: 'Regional and cross-border ground movement.' },
  { slug: 'warehousing', title: 'Warehousing', description: 'Storage and inventory support, shaped around your flow.' },
  { slug: 'packaging', title: 'Packaging', description: 'Preparation and handling for goods in transit.' },
  { slug: 'supply-chain', title: 'Supply chain', description: 'Coordination across the stages between origin and arrival.' },
];
const adminNav: { label: string; href: string; icon: IconType }[] = [
  { label: 'Overview', href: '/admin', icon: LayoutDashboard },
  { label: 'Shipments', href: '/admin/shipments', icon: Truck },
  { label: 'Quotes', href: '/admin/quotes', icon: FileText },
  { label: 'Customers', href: '/admin/customers', icon: Users },
  { label: 'Messages', href: '/admin/messages', icon: LifeBuoy },
  { label: 'Users & roles', href: '/admin/users', icon: ShieldCheck },
  { label: 'Audit log', href: '/admin/audit', icon: FileClock },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
];

function Wordmark() {
  return (
    <span className="wordmark" data-testid="text-brand">
      <img className="wordmark-logo" src={`${basePath}/logo.png`} alt="GLO-PAX" aria-label="GLO-PAX" />
      <span className="sr-only">GLO-PAX</span>
    </span>
  );
}
function Header() {
  return <header className="topbar">
    <Link href="/" aria-label="Home" data-testid="link-home"><Wordmark /></Link>
    <nav className="nav-links" aria-label="Main navigation">
      <Link href="/services" data-testid="link-services">Services</Link>
      <Link href="/about" data-testid="link-about">About</Link>
      <Link href="/tracking" data-testid="link-tracking">Tracking</Link>
      <Link href="/contact" data-testid="link-contact">Contact</Link>
    </nav>
    <div className="header-actions"><Link href="/quote" className="btn btn-primary" data-testid="link-request-quote">Request a quote <ArrowRight size={15} /></Link></div>
  </header>;
}
function Footer() {
  const settings = useGetSiteSettings();
  const company = settings.data?.companyName || 'GLO-PAX';
  return <footer className="footer"><div className="footer-inner">
    <div><Wordmark /><p>Global consignment & logistics, from first request to final delivery.</p></div>
    <div><h4>Explore</h4><Link href="/services">Services</Link><Link href="/about">About</Link><Link href="/tracking">Track a shipment</Link><Link href="/quote">Request a quote</Link></div>
    <div><h4>Connect</h4><Link href="/contact">Contact</Link>{settings.data?.companyEmail ? <a href={`mailto:${settings.data.companyEmail}`}>{settings.data.companyEmail}</a> : <p>Company email not configured</p>}<p>{settings.data?.companyPhone || 'Phone not configured'}</p></div>
    <div><h4>Information</h4><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookie-policy">Cookie policy</Link></div>
  </div><div className="footer-bottom"><span>© {new Date().getFullYear()} {company}</span><span>Operational information, made clear.</span></div></footer>;
}
function PublicShell({ children }: { children: ReactNode }) { return <div className="site-wrap"><Header />{children}<Footer /></div>; }
function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow">{children}</div>; }
function PageHead({ title, body, eyebrow = 'GLO-PAX' }: { title: string; body: string; eyebrow?: string }) {
  return <section className="page-head"><div className="page-head-inner"><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1><p>{body}</p></div></section>;
}
function ErrorNotice({ message = 'We could not load this information.', retry }: { message?: string; retry?: () => void }) {
  return <div className="notice error" role="alert">{message} {retry && <button className="text-link" onClick={retry} data-testid="button-retry">Try again</button>}</div>;
}
function getMutationErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const errObj = error as {
      data?: { error?: string; details?: Array<{ field?: string; message: string }> };
      message?: string;
    };
    if (errObj.data?.details && errObj.data.details.length > 0) {
      return `${errObj.data.error || 'Validation error'}: ${errObj.data.details.map(d => `${d.field ? d.field + ': ' : ''}${d.message}`).join(', ')}`;
    }
    if (errObj.data?.error) {
      return errObj.data.error;
    }
    if (errObj.message?.trim()) {
      return errObj.message;
    }
  }
  return 'The request could not be completed. Please review the form and try again.';
}
function LoadingBlock() { return <div className="skeleton" aria-label="Loading" role="status" />; }
function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><Activity size={23} strokeWidth={1.5} /><strong>{title}</strong><span>{body}</span></div>;
}
function StatusBadge({ status }: { status: string }) {
  const state = status.toLowerCase();
  const kind = ['delivered', 'completed', 'active', 'accepted', 'closed'].includes(state) ? 'good' : ['delayed', 'exception', 'rejected', 'disabled'].includes(state) ? 'alert' : 'warn';
  return <span className={`badge ${kind}`} data-testid={`status-${state.replaceAll(' ', '-')}`}>{status.replaceAll('_', ' ')}</span>;
}
function TrackForm({ compact = false }: { compact?: boolean }) {
  const [, setLocation] = useLocation();
  const [tracking, setTracking] = useState('');
  function submit(e: FormEvent) { e.preventDefault(); if (tracking.trim()) setLocation(`/tracking?number=${encodeURIComponent(tracking.trim())}`); }
  return <form className={compact ? 'track-form' : 'track-form'} onSubmit={submit} data-testid="form-track">
    <label className="sr-only" htmlFor="tracking-number">Tracking number</label><input id="tracking-number" value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Enter your tracking number" required data-testid="input-tracking-number" />
    <button className="btn btn-accent" type="submit" data-testid="button-track">Track shipment <ArrowRight size={15} /></button>
  </form>;
}
function Home() {
  const site = useGetSiteSettings();
  const services = site.data?.services?.length ? site.data.services : serviceLinks;
  return <PublicShell><main>
    <section className="hero"><div className="hero-copy"><Eyebrow>Logistics, made legible</Eyebrow><h1>Move goods.<br /><em>Know where.</em></h1><p>{site.data?.companyDescription || 'A direct line between your shipment and the people coordinating it. Find a service, request a quote, or follow a shipment in progress.'}</p><div className="hero-actions"><Link href="/quote" className="btn btn-primary" data-testid="link-hero-quote">Plan a shipment <ArrowRight size={15} /></Link><Link href="/services" className="btn btn-outline" data-testid="link-hero-services">Explore services</Link></div></div>
      <div className="hero-art" aria-label="Illustration of a shipment moving between two locations"><div className="route-art"><div className="route-line" /><span className="route-point start" /><span className="route-point end" /><span className="route-label origin">Origin</span><span className="route-label destination">Destination</span><div className="route-cargo" /><div className="cargo-tag" /><span className="art-caption">MOVEMENT, MADE VISIBLE</span></div></div>
    </section>
    <div className="track-bar"><div className="track-surface"><div><h2>Already on the move?</h2><p>Enter a tracking number to view the latest available updates.</p></div><TrackForm compact /></div></div>
    <section className="section"><div className="section-inner"><div className="section-heading"><div><Eyebrow>How we can help</Eyebrow><h2>One coordinated journey.<br />The right mode at each step.</h2></div><p>Explore services that can be configured to suit the shape, schedule, and handling needs of your freight.</p></div>
      {site.isLoading ? <LoadingBlock /> : site.isError ? <ErrorNotice message="Service information is temporarily unavailable." retry={() => site.refetch()} /> :
        <div className="service-grid">{services.slice(0, 6).map((service, i) => <Link className="service-card" href={`/services/${service.slug}`} key={service.slug} data-testid={`card-service-${service.slug}`}><span className="service-number">0{i + 1} / SERVICE</span><h3>{service.title}</h3><p>{service.description}</p><span className="text-link">View service <ArrowRight size={14} /></span></Link>)}</div>}
    </div></section>
    <section className="split-band"><div className="band-image" role="img" aria-label="Abstract stacked freight cargo illustration" /><div className="band-copy"><Eyebrow>Visibility with context</Eyebrow><h2>A clear record at every handoff.</h2><p>Operational updates bring shipment status, location, and event history into one view. When provider data is not configured, the platform labels the source clearly rather than filling gaps with assumptions.</p><Link href="/tracking" className="btn btn-primary" data-testid="link-band-tracking">Open tracking <ArrowRight size={15} /></Link></div></section>
    <section className="section"><div className="section-inner"><div className="section-heading"><div><Eyebrow>Start with the next step</Eyebrow><h2>Plan it. Follow it.<br />Get the details when you need them.</h2></div></div><div className="service-grid">
      <div className="service-card"><span className="service-number">01 / PLAN</span><h3>Share the shipment details</h3><p>Tell us where it starts, where it is going, and what needs to move.</p><Link href="/quote" className="text-link" data-testid="link-plan">Request a quote <ArrowRight size={14} /></Link></div>
      <div className="service-card"><span className="service-number">02 / FOLLOW</span><h3>Check the latest update</h3><p>Track a shipment using its reference number and review its event timeline.</p><Link href="/tracking" className="text-link" data-testid="link-follow">Go to tracking <ArrowRight size={14} /></Link></div>
      <div className="service-card"><span className="service-number">03 / CONNECT</span><h3>Talk to the right team</h3><p>Send a question or share information with the operations team.</p><Link href="/contact" className="text-link" data-testid="link-connect">Contact us <ArrowRight size={14} /></Link></div>
    </div></div></section>
  </main></PublicShell>;
}
function AboutPage() {
  const site = useGetSiteSettings();
  return <PublicShell><PageHead title="A clearer way to move freight." body={site.data?.companyDescription || 'This company profile has not been configured yet. Add verified company information in operations settings to publish a complete profile.'} eyebrow="About" />
    <div className="content"><div className="legal-placeholder"><strong>Company profile configuration</strong><p>Company story, operating locations, team details, and verified credentials will appear here when provided by an administrator.</p>{site.isError && <ErrorNotice retry={() => site.refetch()} />}</div><div className="section-heading" style={{ marginTop: 54 }}><div><Eyebrow>Our approach</Eyebrow><h2>Clear records. Fewer assumptions.</h2></div></div><p className="legal-copy">Logistics has many moving parts. The workspace is designed to make the useful details easy to find: where a shipment began, what service was requested, what was last reported, and who can help next.</p><Link href="/contact" className="btn btn-primary" data-testid="link-about-contact">Talk with the team <ArrowRight size={15} /></Link></div>
  </PublicShell>;
}
function ServicesPage() {
  const site = useGetSiteSettings();
  const services = site.data?.services?.length ? site.data.services : serviceLinks;
  return <PublicShell><PageHead title="A service for the shape of your freight." body="Explore available freight and operations services. Details can be configured by the company team." eyebrow="Services" /><div className="content">
    {site.isLoading ? <LoadingBlock /> : site.isError ? <ErrorNotice retry={() => site.refetch()} /> : <div className="service-grid">{services.map((s, i) => <Link className="service-card" href={`/services/${s.slug}`} key={s.slug} data-testid={`card-service-${s.slug}`}><span className="service-number">0{i + 1} / SERVICE</span><h3>{s.title}</h3><p>{s.description}</p><span className="text-link">Service details <ArrowRight size={14} /></span></Link>)}</div>}
  </div></PublicShell>;
}
function ServiceDetail({ slug }: { slug?: string }) {
  const site = useGetSiteSettings();
  const s = (site.data?.services || serviceLinks).find(item => item.slug === slug);
  if (!slug || !s) return <PublicShell><PageHead title="Service not found" body="This service may not be configured. Browse the available services or contact the team for details." eyebrow="Services" /><div className="content"><Link href="/services" className="btn btn-primary">Browse services</Link></div></PublicShell>;
  return <PublicShell><PageHead title={s.title} body={s.description} eyebrow="Service / GLO-PAX" /><div className="content"><div className="legal-copy"><h2>Designed around the shipment</h2><p>Share the origin, destination, shipment type, and handling requirements. The operations team can review the information and follow up with the next appropriate steps.</p><h2>Start with the details</h2><p>Service availability and terms should be confirmed for each request. No transit time, coverage, or performance claims are implied on this page.</p></div><div className="form-actions"><Link href="/quote" className="btn btn-primary" data-testid={`link-quote-${slug}`}>Request a quote <ArrowRight size={15} /></Link><Link href="/contact" className="btn btn-outline">Ask a question</Link></div></div></PublicShell>;
}

function TrackingPage() {
  const [location] = useLocation();
  const [number, setNumber] = useState(() => new URLSearchParams(window.location.search).get('number') || '');
  const [lookup, setLookup] = useState(() => new URLSearchParams(window.location.search).get('number') || '');
  useEffect(() => {
    const urlNum = new URLSearchParams(window.location.search).get('number') || '';
    if (urlNum && urlNum !== lookup) {
      setNumber(urlNum);
      setLookup(urlNum);
    }
  }, [location]);
  const tracking = useGetPublicTracking(lookup.trim(), { query: { enabled: !!lookup.trim(), queryKey: getGetPublicTrackingQueryKey(lookup.trim()) } });
  function submit(e: FormEvent) { e.preventDefault(); setLookup(number.trim()); }
  return <PublicShell><PageHead title="Tracking, without guesswork." body="Enter a shipment tracking number to view the most recent available status and event history." eyebrow="Shipment visibility" />
    <div className="content"><form className="form-card" onSubmit={submit}><div className="field"><label htmlFor="track-number">Tracking number</label><div className="track-form"><input id="track-number" value={number} onChange={e => setNumber(e.target.value)} required placeholder="Enter tracking number" data-testid="input-tracking-number" /><button className="btn btn-primary" type="submit" disabled={tracking.isFetching} data-testid="button-track">Look up <Search size={15} /></button></div></div></form>
      {!lookup && <div className="notice info">Tracking details appear after you enter a reference number. No sample tracking records are shown.</div>}
      {tracking.isLoading && <div style={{ marginTop: 20 }}><LoadingBlock /></div>}
      {tracking.isError && lookup && <ErrorNotice message="We could not find tracking details for that reference. Check the number or contact the team." retry={() => tracking.refetch()} />}
      {tracking.data && <section className="panel" style={{ marginTop: 24 }}><div className="panel-title"><div><Eyebrow>Shipment / {tracking.data.shipment.trackingNumber}</Eyebrow><h2 style={{ marginTop: 9 }}>{tracking.data.shipment.origin} <ArrowRight size={16} /> {tracking.data.shipment.destination}</h2></div><StatusBadge status={tracking.data.shipment.status} /></div>
        <p style={{ color: '#66757b', fontSize: 12 }}>Service: {tracking.data.shipment.serviceType} · Last known location: {tracking.data.shipment.currentLocation || 'Not available'}{tracking.data.shipment.isDemo ? ' · Development record' : ''}</p>
        <Suspense fallback={<div className="map-unavailable">Preparing the location map...</div>}><TrackingMap origin={tracking.data.shipment.origin} currentLocation={tracking.data.shipment.currentLocation} destination={tracking.data.shipment.destination} /></Suspense>
        {!tracking.data.events.length ? <Empty title="No tracking events yet" body="An update will appear here when the shipment has an event." /> : <div className="timeline" style={{ marginTop: 30 }}>{tracking.data.events.map(event => <div className="timeline-item" key={event.id} data-testid={`event-tracking-${event.id}`}><span className="timeline-mark" /><div><strong>{event.status}</strong><p>{event.description}{event.location ? ` · ${event.location}` : ''}</p><time>{new Date(event.eventTimestamp).toLocaleString()} · {event.source}</time></div></div>)}</div>}</section>}
    </div></PublicShell>;
}

function QuotePage() {
  const create = useCreateQuote();
  const [success, setSuccess] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSuccess(false);
    const form = e.currentTarget;
    const d = new FormData(form);
    create.mutate({ data: {
      customerName: String(d.get('name')), email: String(d.get('email')), phone: String(d.get('phone') || ''),
      origin: String(d.get('origin')), destination: String(d.get('destination')), shipmentType: String(d.get('type')),
      weight: d.get('weight') ? Number(d.get('weight')) : null, dimensions: String(d.get('dimensions') || ''),
      description: String(d.get('description') || ''), preferredShippingDate: String(d.get('date') || '') || null,
      additionalInformation: String(d.get('details') || ''),
    } }, { onSuccess: () => { setSuccess(true); form.reset(); } });
  }
  return <PublicShell><PageHead title="Tell us what needs to move." body="Share the shipment basics. The operations team can review your request and follow up." eyebrow="Quote request" /><div className="content">
    <form className="form-card" onSubmit={submit} data-testid="form-quote"><div className="form-grid">
      <Field label="Your name" name="name" required /><Field label="Email address" name="email" type="email" required />
      <Field label="Phone (optional)" name="phone" type="tel" /><Field label="Shipment type" name="type" required placeholder="Air, ocean, road…" />
      <Field label="Origin" name="origin" required /><Field label="Destination" name="destination" required />
      <Field label="Weight" name="weight" type="number" min="0" placeholder="kg" /><Field label="Dimensions" name="dimensions" placeholder="Length × width × height" />
      <Field label="Preferred shipping date" name="date" type="date" /><Field label="Cargo description" name="description" />
      <Field label="Additional information" name="details" textarea />
    </div>{create.isError && <ErrorNotice message="Your request could not be submitted. Please check the form and try again." />}
    {success && <div className="notice success" role="status">Quote request received. The request has been recorded for the operations team.</div>}
    <div className="form-actions"><button className="btn btn-primary" disabled={create.isPending} type="submit" data-testid="button-submit-quote">{create.isPending ? 'Submitting…' : 'Send quote request'} <ArrowRight size={15} /></button><span style={{ fontSize: 11, color: '#738087' }}>Required fields are marked by your browser.</span></div></form>
  </div></PublicShell>;
}
function Field({ label, name, type = 'text', required = false, placeholder, textarea = false, min }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; textarea?: boolean; min?: string }) {
  return <div className={`field ${textarea ? 'full' : ''}`}><label htmlFor={`field-${name}`}>{label}</label>{textarea ? <textarea id={`field-${name}`} name={name} placeholder={placeholder} required={required} data-testid={`input-${name}`} /> : <input id={`field-${name}`} name={name} type={type} min={min} required={required} placeholder={placeholder} data-testid={`input-${name}`} />}</div>;
}
function ContactPage() {
  const create = useCreateContact();
  const [sent, setSent] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSent(false); const form = e.currentTarget; const d = new FormData(form);
    create.mutate({ data: { name: String(d.get('name')), email: String(d.get('email')), phone: String(d.get('phone') || ''), subject: String(d.get('subject')), message: String(d.get('message')) } }, { onSuccess: () => { setSent(true); form.reset(); } });
  }
  return <PublicShell><PageHead title="A question, a detail, a handoff." body="Send a message to the team. Include a tracking number when your question is about a shipment." eyebrow="Contact" /><div className="content">
    <form className="form-card" onSubmit={submit} data-testid="form-contact"><div className="form-grid">
      <Field label="Name" name="name" required /><Field label="Email" name="email" type="email" required /><Field label="Phone (optional)" name="phone" type="tel" /><Field label="Subject" name="subject" required /><Field label="Message" name="message" required textarea />
    </div>{create.isError && <ErrorNotice message="Your message could not be sent. Please try again." />}{sent && <div className="notice success" role="status">Message received. Thank you for getting in touch.</div>}
    <div className="form-actions"><button className="btn btn-primary" disabled={create.isPending} type="submit" data-testid="button-send-contact">{create.isPending ? 'Sending…' : 'Send message'} <ArrowRight size={15} /></button></div></form>
  </div></PublicShell>;
}

const legalContent: Record<string, { title: string; subtitle: string; slug: string }> = {
  privacy: { title: 'Privacy policy', subtitle: 'A placeholder for the company’s privacy disclosures.', slug: 'privacy' },
  terms: { title: 'Terms of service', subtitle: 'A placeholder for the terms governing use of these services.', slug: 'terms' },
  'cookie-policy': { title: 'Cookie policy', subtitle: 'A placeholder for information about cookies and similar technologies.', slug: 'cookie-policy' },
};
function LegalPage({ slug }: { slug: string }) {
  const item = legalContent[slug];
  return <PublicShell><PageHead title={item.title} body={item.subtitle} eyebrow="Legal information" /><div className="content"><article className="legal-copy"><div className="legal-placeholder"><strong>Editable legal placeholder</strong><p>This page is a development placeholder and is not legal advice. Replace it with company-approved language before publication.</p><p>Last reviewed: not configured</p></div><h2>Information and scope</h2><p>Company-specific information about data collected, purposes of use, retention, sharing, user choices, and contact details has not been supplied. Add accurate, reviewed terms here before this page is relied upon.</p><h2>Questions</h2><p>For questions about this placeholder, contact the company through the <Link className="text-link" href="/contact">contact page</Link>.</p></article></div></PublicShell>;
}

function ClerkSignIn() { return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>; }
function ClerkSignUp() { return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>; }
function AuthFrame({ children }: { children: ReactNode }) {
  return <div className="site-wrap" style={{ minHeight: '100dvh', background: '#eae3d7' }}><div className="topbar"><Link href="/" data-testid="link-home"><Wordmark /></Link><Link href="/" className="text-link">Back to home <ArrowRight size={14} /></Link></div><main style={{ padding: '30px 18px 70px', display: 'grid', placeItems: 'center' }}><div style={{ textAlign: 'center', marginBottom: 20 }}><Eyebrow>GLO-PAX workspace</Eyebrow><h1 className="font-display" style={{ color: '#20384c', fontSize: 30, letterSpacing: '-.05em', margin: '14px 0 6px' }}>Your work, in motion.</h1><p style={{ color: '#64727a', fontSize: 13 }}>Sign in to reach your shipment and operations workspace.</p></div>{children}</main></div>;
}
function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  useEffect(() => {
    let previous: string | null | undefined;
    const unsubscribe = addListener(({ user }: { user?: { id?: string | null } | null }) => {
      const current = user?.id ?? null;
      if (previous !== undefined && previous !== current) cache.clear();
      previous = current;
    });
    return unsubscribe;
  }, [addListener, cache]);
  return null;
}
function ClerkTokenSync() {
  const { getToken, isSignedIn } = useAuth();
  useEffect(() => {
    if (isSignedIn) {
      setAuthTokenGetter(async () => {
        try {
          return await getToken();
        } catch {
          return null;
        }
      });
    } else {
      setAuthTokenGetter(null);
    }
  }, [getToken, isSignedIn]);
  return null;
}
function LogoutButton() {
  const { signOut } = useClerk();
  return <button className="btn btn-quiet" type="button" onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out">Sign out</button>;
}
function Protected({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <main className="content"><LoadingBlock /></main>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return admin ? <AdminGuard>{children}</AdminGuard> : <>{children}</>;
}
function AdminGuard({ children }: { children: ReactNode }) {
  const me = useGetCurrentUser();
  if (me.isLoading) return <main className="content"><LoadingBlock /></main>;
  if (me.isError) return <div className="content"><ErrorNotice message="Your operations access could not be confirmed." retry={() => me.refetch()} /></div>;
  if (!me.data) return <div className="content"><ErrorNotice message="No operations profile is available for this account." retry={() => me.refetch()} /></div>;
  if (!['admin', 'staff', 'super_admin'].includes(me.data.role)) return <Redirect to="/dashboard" />;
  return <>{children}</>;
}
function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) return <Redirect to="/dashboard" />;
  return <Home />;
}

function DashboardFrame({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const [location] = useLocation();
  const { user } = useUser();
  const nav = admin ? adminNav : [
    { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Shipments', href: '/dashboard?tab=shipments', icon: Truck },
    { label: 'Quote requests', href: '/dashboard?tab=quotes', icon: FileText },
    { label: 'Notifications', href: '/dashboard?tab=notifications', icon: Activity },
    { label: 'Profile', href: '/dashboard?tab=profile', icon: Users },
  ];
  return <div className="dashboard-shell">
    <aside className="dash-side"><Link href="/dashboard"><Wordmark /></Link><div className="dash-label">{admin ? 'Operations workspace' : 'Customer workspace'}</div>
      <nav className="dash-nav" aria-label={admin ? 'Operations navigation' : 'Customer navigation'}>{nav.map(item => {
        const I = item.icon;
        const active = location === item.href || (item.href === '/admin' && location === '/admin') || (item.href === '/dashboard' && location === '/dashboard' && !new URLSearchParams(window.location.search).get('tab'));
        return <Link href={item.href} className={active ? 'active' : ''} key={item.href} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}><I size={16} /><span>{item.label}</span></Link>;
      })}</nav>
      <div className="dash-foot">{admin ? 'Operational records' : 'Shipment visibility'}<br />{user?.primaryEmailAddress?.emailAddress || 'Signed-in workspace'}</div>
    </aside>
    <div className="dash-main"><header className="dash-top"><span className="dash-top-title">{admin ? 'Operations / Records' : 'Customer / Workspace'}</span><div className="dash-top-actions"><span>{user?.firstName || 'Account'}</span><LogoutButton /></div></header><main className="dash-body">{children}</main></div>
  </div>;
}
function DashHeading({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return <div className="dash-heading"><div><h1 data-testid="text-page-title">{title}</h1>{sub && <p>{sub}</p>}</div>{action}</div>;
}
function QueryState({ loading, error, retry, children }: { loading: boolean; error: boolean; retry: () => void; children: ReactNode }) {
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorNotice message="The service could not load this data." retry={retry} />;
  return <>{children}</>;
}
function DashboardEntry() {
  const me = useGetCurrentUser();
  if (me.isLoading) return <main className="content"><LoadingBlock /></main>;
  if (me.isError || !me.data) return <div className="content"><ErrorNotice message="Your workspace access could not be confirmed." retry={() => me.refetch()} /></div>;
  if (['admin', 'staff', 'super_admin'].includes(me.data.role)) return <Redirect to="/admin" />;
  return <CustomerDashboard />;
}
function CustomerDashboard() {
  const query = new URLSearchParams(window.location.search);
  const tab = query.get('tab') || 'overview';
  const shipments = useGetCustomerShipments();
  const quotes = useGetCustomerQuotes();
  const notifications = useGetCustomerNotifications();
  const me = useGetCurrentUser();
  const mark = useMarkNotificationRead();
  const update = useUpdateCurrentUser();
  const cache = useQueryClient();
  const [saved, setSaved] = useState(false);
  const isHome = tab === 'overview';
  return <DashboardFrame>
    <DashHeading title={tab === 'overview' ? 'Your shipments, at a glance.' : tab === 'shipments' ? 'Shipment record' : tab === 'quotes' ? 'Quote requests' : tab === 'notifications' ? 'Notifications' : 'Your profile'} sub="Current records from your customer account." action={<Link href="/quote" className="btn btn-primary" data-testid="link-new-quote">Request a quote <ArrowRight size={15} /></Link>} />
    {isHome && <><div className="metric-grid">
      <div className="metric"><label>Shipments</label><strong>{shipments.isLoading ? '—' : shipments.data?.length ?? '—'}</strong><small>Available in your account</small></div>
      <div className="metric"><label>In progress</label><strong>{shipments.data?.filter(s => !['delivered', 'completed'].includes(s.status.toLowerCase())).length ?? '—'}</strong><small>Not marked delivered</small></div>
      <div className="metric"><label>Quote requests</label><strong>{quotes.data?.length ?? '—'}</strong><small>Submitted requests</small></div>
      <div className="metric"><label>Unread updates</label><strong>{notifications.data?.filter(n => !n.readAt).length ?? '—'}</strong><small>Account notifications</small></div>
    </div>
      <div className="dash-columns"><section className="panel"><div className="panel-title"><h2>Recent shipments</h2><Link href="/dashboard?tab=shipments" className="text-link">View all <ArrowRight size={14} /></Link></div>
        <QueryState loading={shipments.isLoading} error={shipments.isError} retry={() => shipments.refetch()}>{shipments.data?.length ? <ShipmentTable items={shipments.data.slice(0, 5)} /> : <Empty title="No shipments to show" body="Shipment records connected to your account will appear here." />}</QueryState>
      </section><section className="panel"><div className="panel-title"><h2>Latest updates</h2><Link href="/dashboard?tab=notifications" className="text-link">Notifications <ArrowRight size={14} /></Link></div>
        <QueryState loading={notifications.isLoading} error={notifications.isError} retry={() => notifications.refetch()}>{notifications.data?.length ? <div className="event-list">{notifications.data.slice(0, 5).map(n => <div className="event-item" key={n.id} data-testid={`notification-${n.id}`}><span className="event-dot" /><div><strong>{n.title}</strong><p>{n.message}</p></div><time>{new Date(n.createdAt).toLocaleDateString()}</time></div>)}</div> : <Empty title="All quiet" body="New account and shipment updates will appear here." />}</QueryState>
      </section></div></>}
    {tab === 'shipments' && <section className="panel"><div className="panel-title"><h2>Shipment records</h2><span className="badge">Private to your account</span></div><QueryState loading={shipments.isLoading} error={shipments.isError} retry={() => shipments.refetch()}>{shipments.data?.length ? <ShipmentTable items={shipments.data} /> : <Empty title="No shipment records" body="Shipments associated with your account will show here." />}</QueryState></section>}
    {tab === 'quotes' && <section className="panel"><div className="panel-title"><h2>Your quote requests</h2><Link href="/quote" className="text-link">New request <ArrowRight size={14} /></Link></div><QueryState loading={quotes.isLoading} error={quotes.isError} retry={() => quotes.refetch()}>{quotes.data?.length ? <QuoteTable items={quotes.data} /> : <Empty title="No quote requests" body="Your submitted quote requests will appear here." />}</QueryState></section>}
    {tab === 'notifications' && <section className="panel"><div className="panel-title"><h2>Account notifications</h2></div><QueryState loading={notifications.isLoading} error={notifications.isError} retry={() => notifications.refetch()}>{notifications.data?.length ? <div className="event-list">{notifications.data.map(n => <div className="event-item" key={n.id} data-testid={`notification-${n.id}`}><span className="event-dot" /><div><strong>{n.title}</strong><p>{n.message}</p>{!n.readAt && <button className="text-link" disabled={mark.isPending} onClick={() => mark.mutate({ id: n.id }, { onSuccess: () => cache.invalidateQueries({ queryKey: getGetCustomerNotificationsQueryKey() }) })} data-testid={`button-read-${n.id}`}>Mark as read <Check size={13} /></button>}</div><time>{new Date(n.createdAt).toLocaleString()}</time></div>)}</div> : <Empty title="No notifications" body="Important shipment and account updates will appear here." />}</QueryState>{mark.isError && <ErrorNotice message="The notification could not be updated." />}</section>}
    {tab === 'profile' && <section className="panel" style={{ maxWidth: 750 }}><div className="panel-title"><h2>Profile details</h2></div><QueryState loading={me.isLoading} error={me.isError} retry={() => me.refetch()}>{me.data && <form onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); setSaved(false); update.mutate({ data: { name: String(d.get('name')), phone: String(d.get('phone') || ''), address: String(d.get('address') || ''), country: String(d.get('country') || '') } }, { onSuccess: () => { setSaved(true); cache.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); } }); }} data-testid="form-profile">
      <div className="form-grid"><div className="field"><label htmlFor="profile-name">Name</label><input id="profile-name" name="name" defaultValue={me.data.name} required data-testid="input-profile-name" /></div><div className="field"><label>Email</label><input value={me.data.email} readOnly aria-readonly="true" data-testid="input-profile-email" /></div><div className="field"><label htmlFor="profile-phone">Phone</label><input id="profile-phone" name="phone" defaultValue={me.data.phone || ''} data-testid="input-profile-phone" /></div><div className="field"><label htmlFor="profile-country">Country</label><input id="profile-country" name="country" defaultValue={me.data.country || ''} data-testid="input-profile-country" /></div><div className="field full"><label htmlFor="profile-address">Address</label><input id="profile-address" name="address" defaultValue={me.data.address || ''} data-testid="input-profile-address" /></div></div>{update.isError && <ErrorNotice message="Profile changes could not be saved." />}{saved && <div className="notice success" role="status">Profile updated.</div>}<div className="form-actions"><button className="btn btn-primary" disabled={update.isPending} type="submit" data-testid="button-save-profile">{update.isPending ? 'Saving…' : 'Save profile'}</button></div></form>}</QueryState></section>}
  </DashboardFrame>;
}
function ShipmentTable({ items }: { items: Shipment[] }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Tracking reference</th><th>Route</th><th>Service</th><th>Status</th><th>Est. delivery</th></tr></thead><tbody>{items.map(s => <tr key={s.id} data-testid={`row-shipment-${s.id}`}><td className="mono">{s.trackingNumber}{s.isDemo && <small> · Development</small>}</td><td>{s.origin} → {s.destination}</td><td>{s.serviceType}</td><td><StatusBadge status={s.status} /></td><td>{s.estimatedDelivery ? new Date(s.estimatedDelivery).toLocaleDateString() : 'Not provided'}</td></tr>)}</tbody></table></div>;
}
function QuoteTable({ items }: { items: Quote[] }) {
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Route</th><th>Type</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{items.map(q => <tr key={q.id} data-testid={`row-quote-${q.id}`}><td className="mono">Q-{q.id}</td><td>{q.origin} → {q.destination}</td><td>{q.shipmentType}</td><td><StatusBadge status={q.status} /></td><td>{new Date(q.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div>;
}

function AdminHome() {
  const q = useGetAdminDashboard();
  const health = useHealthCheck();
  const data = q.data;
  return <DashboardFrame admin><DashHeading title="Operations overview" sub="Live operational records from the connected workspace." action={<Link href="/admin/shipments/new" className="btn btn-primary" data-testid="link-create-shipment"><PackagePlus size={15} /> Create shipment</Link>} />
    <QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{data && <>
      <div className="metric-grid">
        <div className="metric"><label>Total shipments</label><strong>{data.totalShipments}</strong><small>Current recorded total</small></div>
        <div className="metric"><label>Active shipments</label><strong>{data.activeShipments}</strong><small>In progress</small></div>
        <div className="metric"><label>Delivered</label><strong>{data.deliveredShipments}</strong><small>Recorded as delivered</small></div>
        <div className="metric"><label>Pending quotes</label><strong>{data.pendingQuotes}</strong><small>Awaiting review</small></div>
      </div>
      <div className="dash-columns"><section className="panel"><div className="panel-title"><h2>Recent tracking events</h2><Link href="/admin/shipments" className="text-link">Shipments <ArrowRight size={14} /></Link></div>
        {data.recentEvents.length ? <div className="event-list">{data.recentEvents.map((event, i) => <div className="event-item" key={`${event.trackingNumber}-${i}`} data-testid={`event-recent-${i}`}><span className="event-dot" /><div><strong>{event.trackingNumber} · {event.status}</strong><p>{event.description} · Source: {event.source}</p></div><time>{new Date(event.eventTimestamp).toLocaleString()}</time></div>)}</div> : <Empty title="No recent events" body="Tracking activity will appear here as operational records are updated." />}
      </section><section className="panel"><div className="panel-title"><h2>Shipment status</h2><span className={`badge ${data.providerConfigured ? 'good' : 'warn'}`}>{data.providerConfigured ? 'Provider configured' : 'Provider not configured'}</span></div>
        {data.statusCounts.length ? <div className="event-list">{data.statusCounts.map((status, i) => <div className="event-item" key={`${status.status}-${i}`}><span className="event-dot" /><div><strong>{status.status}</strong><p>Recorded shipment status</p></div><span className="badge">{status.count}</span></div>)}</div> : <Empty title="No status records" body="Counts will appear when the workspace has shipment data." />}
      </section></div>
    </>}</QueryState>
    <div className="notice info">Aggregate figures and event activity reflect the API records. Development labels are shown on individual shipment records when the API marks them as demo data.</div>
    {health.isError && <div className="notice error" style={{ marginTop: 18 }}>API health check could not be reached. <button className="text-link" onClick={() => health.refetch()} data-testid="button-health-retry">Retry</button></div>}
  </DashboardFrame>;
}
function AdminShipments() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined, page: 1, pageSize: 50 }), [search, status]);
  const q = useGetAdminShipments(params);
  const page = q.data;
  return <DashboardFrame admin><DashHeading title="Shipments" sub="Search and review operational shipment records." action={<Link href="/admin/shipments/new" className="btn btn-primary" data-testid="link-create-shipment"><PackagePlus size={15} /> New shipment</Link>} />
    <div className="toolbar"><label className="sr-only" htmlFor="shipment-search">Search shipments</label><input className="search-input" id="shipment-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reference, route or customer" data-testid="input-shipment-search" /><select className="search-input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter by status" data-testid="select-shipment-status"><option value="">All statuses</option><option>pending</option><option>in_transit</option><option>delivered</option><option>exception</option><option>delayed</option></select><span className="badge">{page?.total ?? '—'} records</span></div>
    <section className="panel"><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{page?.items.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Tracking</th><th>Customer</th><th>Origin → destination</th><th>Service</th><th>Status</th><th>Updated</th><th>Record</th></tr></thead><tbody>{page.items.map(s => <tr key={s.id} data-testid={`row-shipment-${s.id}`}><td className="mono">{s.trackingNumber}{s.isDemo && <span className="badge warn">Development</span>}</td><td>{s.customerName || 'Unassigned'}</td><td>{s.origin} → {s.destination}</td><td>{s.serviceType}</td><td><StatusBadge status={s.status} /></td><td>{new Date(s.updatedAt).toLocaleDateString()}</td><td><Link href={`/admin/shipments/${s.id}`} className="text-link" data-testid={`link-shipment-${s.id}`}>Open <ArrowRight size={13} /></Link></td></tr>)}</tbody></table></div> : <Empty title="No shipments found" body={search || status ? 'Try changing the filters.' : 'Shipment records will appear here when created.'} />}</QueryState></section>
  </DashboardFrame>;
}
function CreateShipmentPage() {
  const create = useCreateShipment();
  const customers = useGetAdminCustomers();
  const cache = useQueryClient();
  const [, setLocation] = useLocation();
  return <DashboardFrame admin><DashHeading title="Create shipment" sub="Create an operational record. Fields marked required must be provided." action={<Link href="/admin/shipments" className="btn btn-outline">Cancel</Link>} />
    <form className="form-card" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const serviceType = String(f.get('serviceType') || '').trim();
      const origin = String(f.get('origin') || '').trim();
      const destination = String(f.get('destination') || '').trim();
      const status = String(f.get('status') || '').trim() || 'pending';
      const custId = f.get('customerId');
      const customerId = custId && String(custId).trim() ? Number(custId) : null;
      const carrier = String(f.get('carrier') || '').trim() || null;
      const carrierTrackingNumber = String(f.get('carrierTrackingNumber') || '').trim() || null;
      const weightVal = f.get('weight');
      const weight = weightVal !== null && weightVal !== '' && !Number.isNaN(Number(weightVal)) ? Number(weightVal) : null;
      const dimensions = String(f.get('dimensions') || '').trim() || null;
      const packageDescription = String(f.get('packageDescription') || '').trim() || null;
      const estVal = f.get('estimatedDelivery');
      const estimatedDelivery = estVal && String(estVal).trim() ? String(estVal).trim() : null;

      create.mutate({
        data: {
          serviceType,
          origin,
          destination,
          status,
          customerId,
          carrier,
          carrierTrackingNumber,
          weight,
          dimensions,
          packageDescription,
          estimatedDelivery,
        }
      }, {
        onSuccess: shipment => {
          cache.invalidateQueries({ queryKey: getGetAdminShipmentsQueryKey() });
          cache.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() });
          setLocation(`/admin/shipments/${shipment.id}`);
        }
      });
    }} data-testid="form-create-shipment">
      <div className="form-grid">
        <Field label="Service type" name="serviceType" required placeholder="Air freight, ocean freight…" />
        <div className="field">
          <label htmlFor="field-customerId">Customer (optional)</label>
          <select id="field-customerId" name="customerId" data-testid="select-customer">
            <option value="">Unassigned (No customer)</option>
            {customers.data?.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
            ))}
          </select>
        </div>
        <Field label="Origin" name="origin" required />
        <Field label="Destination" name="destination" required />
        <div className="field">
          <label htmlFor="field-status">Current status</label>
          <select id="field-status" name="status" defaultValue="pending" data-testid="select-shipment-status">
            <option value="pending">Pending</option>
            <option value="in_transit">In transit</option>
            <option value="delayed">Delayed</option>
            <option value="exception">Exception</option>
            <option value="delivered">Delivered</option>
          </select>
        </div>
        <Field label="Carrier" name="carrier" />
        <Field label="Carrier tracking number" name="carrierTrackingNumber" />
        <Field label="Weight (kg)" name="weight" type="number" min="0" />
        <Field label="Dimensions" name="dimensions" />
        <Field label="Estimated delivery" name="estimatedDelivery" type="date" />
        <Field label="Package description" name="packageDescription" textarea />
      </div>
      {create.isError && <ErrorNotice message={getMutationErrorMessage(create.error)} />}
      <div className="notice info">A tracking reference is generated by the operations API. Do not use unverified sample records.</div>
      <div className="form-actions"><button className="btn btn-primary" disabled={create.isPending} type="submit" data-testid="button-create-shipment">{create.isPending ? 'Creating…' : 'Create shipment'} <ArrowRight size={15} /></button></div>
    </form>
  </DashboardFrame>;
}
function ShipmentDetailPage({ id }: { id?: string }) {
  const shipmentId = Number(id);
  const q = useGetAdminShipment(shipmentId, { query: { enabled: Number.isFinite(shipmentId) && shipmentId > 0, queryKey: getGetAdminShipmentQueryKey(shipmentId) } });
  const update = useUpdateShipment();
  const addEvent = useCreateTrackingEvent();
  const sync = useSyncShipmentTracking();
  const cache = useQueryClient();
  const [eventSaved, setEventSaved] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const detail = q.data;
  const invalidate = () => { cache.invalidateQueries({ queryKey: getGetAdminShipmentQueryKey(shipmentId) }); cache.invalidateQueries({ queryKey: getGetAdminShipmentsQueryKey() }); cache.invalidateQueries({ queryKey: getGetAdminDashboardQueryKey() }); };
  return <DashboardFrame admin><DashHeading title={detail?.shipment.trackingNumber || 'Shipment detail'} sub="Shipment record and event history." action={<Link href="/admin/shipments" className="btn btn-outline">Back to shipments</Link>} />
    <QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{detail && <div className="dash-columns">
      <div className="panel"><div className="panel-title"><h2>Shipment details</h2><StatusBadge status={detail.shipment.status} /></div><p className="mono">{detail.shipment.origin} → {detail.shipment.destination}</p><p className="legal-copy">Service: {detail.shipment.serviceType}<br />Customer: {detail.shipment.customerName || 'Unassigned'}<br />Carrier: {detail.shipment.carrier || 'Not assigned'}<br />Carrier tracking number: {detail.shipment.carrierTrackingNumber || 'Not provided'}<br />Current location: {detail.shipment.currentLocation || 'Not provided'}<br />Weight: {detail.shipment.weight ?? 'Not provided'}<br />Dimensions: {detail.shipment.dimensions || 'Not provided'}<br />Package: {detail.shipment.packageDescription || 'Not provided'}<br />Estimated delivery: {detail.shipment.estimatedDelivery ? new Date(detail.shipment.estimatedDelivery).toLocaleDateString() : 'Not provided'}<br />Actual delivery: {detail.shipment.actualDelivery ? new Date(detail.shipment.actualDelivery).toLocaleDateString() : 'Not provided'}<br />Created: {new Date(detail.shipment.createdAt).toLocaleString()}<br />Updated: {new Date(detail.shipment.updatedAt).toLocaleString()}<br />Record type: {detail.shipment.isDemo ? 'Development record' : 'Operational record'}</p>
        <form className="form-grid" onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); update.mutate({ id: shipmentId, data: { status: String(d.get('status')), currentLocation: String(d.get('currentLocation') || ''), carrier: String(d.get('carrier') || '') } }, { onSuccess: invalidate }); }} data-testid="form-update-shipment">
          <div className="field"><label htmlFor="ship-status">Status</label><select id="ship-status" name="status" defaultValue={detail.shipment.status}><option value="pending">Pending</option><option value="in_transit">In transit</option><option value="delayed">Delayed</option><option value="exception">Exception</option><option value="delivered">Delivered</option></select></div><div className="field"><label htmlFor="ship-location">Current location</label><input id="ship-location" name="currentLocation" defaultValue={detail.shipment.currentLocation || ''} /></div><div className="field full"><label htmlFor="ship-carrier">Carrier</label><input id="ship-carrier" name="carrier" defaultValue={detail.shipment.carrier || ''} /></div><div className="field full"><button className="btn btn-primary" disabled={update.isPending} type="submit" data-testid="button-update-shipment">Save changes</button></div>
        </form>{update.isError && <ErrorNotice message="Shipment update could not be saved." />}{update.isSuccess && <div className="notice success">Shipment record updated.</div>}
        <div className="form-actions"><button className="btn btn-outline" type="button" disabled={sync.isPending} onClick={() => { setSyncMessage(''); sync.mutate({ id: shipmentId }, { onSuccess: result => { setSyncMessage(result.message); invalidate(); } }); }} data-testid="button-sync-tracking">{sync.isPending ? 'Checking provider…' : 'Sync carrier updates'} <Activity size={14} /></button></div>{syncMessage && <div className="notice info">{syncMessage}</div>}{sync.isError && <ErrorNotice message="Carrier sync could not be completed." />}
      </div>
      <div className="panel"><div className="panel-title"><h2>Event history</h2><span className="badge">{detail.events.length} events</span></div>{detail.events.length ? <div className="timeline">{detail.events.map(ev => <div className="timeline-item" key={ev.id} data-testid={`event-${ev.id}`}><span className="timeline-mark" /><div><strong>{ev.status}</strong><p>{ev.description} {ev.location && `· ${ev.location}`}</p><time>{new Date(ev.eventTimestamp).toLocaleString()} · {ev.source}</time></div></div>)}</div> : <Empty title="No events recorded" body="Add an internal event to start the shipment history." />}
        <form onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const d = new FormData(form); const data: TrackingEventInput = { status: String(d.get('status')), description: String(d.get('description')), location: String(d.get('location') || ''), eventTimestamp: String(d.get('timestamp')) }; addEvent.mutate({ id: shipmentId, data }, { onSuccess: () => { setEventSaved(true); form.reset(); invalidate(); } }); }} data-testid="form-tracking-event">
          <div className="form-grid"><div className="field"><label htmlFor="event-status">Event status</label><input id="event-status" name="status" required minLength={2} maxLength={80} data-testid="input-event-status" /></div><div className="field"><label htmlFor="event-location">Location</label><input id="event-location" name="location" data-testid="input-event-location" /></div><div className="field full"><label htmlFor="event-description">Description</label><textarea id="event-description" name="description" required minLength={2} maxLength={500} data-testid="input-event-description" /></div><div className="field full"><label htmlFor="event-time">Event time</label><input id="event-time" name="timestamp" type="datetime-local" required data-testid="input-event-time" /></div></div>
          {addEvent.isError && <ErrorNotice message="The tracking event could not be added." />}{eventSaved && <div className="notice success">Event added to the shipment record.</div>}<div className="form-actions"><button className="btn btn-primary" disabled={addEvent.isPending} type="submit" data-testid="button-add-event">Add internal event</button></div>
        </form>
      </div>
    </div>}</QueryState>
  </DashboardFrame>;
}
function AdminQuotes() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Quote | null>(null);
  const params = useMemo(() => ({ search: search || undefined, status: status || undefined }), [search, status]);
  const q = useGetAdminQuotes(params);
  const update = useUpdateQuote();
  const cache = useQueryClient();
  return <DashboardFrame admin><DashHeading title="Quote requests" sub="Review requests and record the current decision." />
    <div className="toolbar"><input className="search-input" aria-label="Search quotes" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, email or route" data-testid="input-quote-search" /><select className="search-input" aria-label="Filter quote status" value={status} onChange={e => setStatus(e.target.value)} data-testid="select-quote-status"><option value="">All statuses</option>{['pending', 'reviewing', 'quoted', 'accepted', 'rejected', 'completed'].map(s => <option key={s}>{s}</option>)}</select></div>
    <section className="panel"><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Route / type</th><th>Submitted</th><th>Status</th><th>Details</th><th>Private review notes</th></tr></thead><tbody>{q.data.map(item => <tr key={item.id} data-testid={`row-quote-${item.id}`}><td><strong>{item.customerName}</strong><br />Q-{item.id}</td><td>{item.email}<br />{item.phone || 'No phone'}</td><td>{item.origin} → {item.destination}<br />{item.shipmentType}</td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><select aria-label={`Update quote ${item.id} status`} value={item.status} onChange={e => update.mutate({ id: item.id, data: { status: e.target.value as Quote['status'] } }, { onSuccess: () => cache.invalidateQueries({ queryKey: getGetAdminQuotesQueryKey() }) })} data-testid={`select-quote-update-${item.id}`}>{['pending', 'reviewing', 'quoted', 'accepted', 'rejected', 'completed'].map(s => <option key={s}>{s}</option>)}</select></td><td><button className="text-link" onClick={() => setSelected(selected?.id === item.id ? null : item)} data-testid={`button-quote-detail-${item.id}`}>{selected?.id === item.id ? 'Close' : 'Open'} <ArrowRight size={13} /></button></td><td><form onSubmit={e => { e.preventDefault(); const d = new FormData(e.currentTarget); update.mutate({ id: item.id, data: { adminNotes: String(d.get('notes') || '') } }, { onSuccess: () => cache.invalidateQueries({ queryKey: getGetAdminQuotesQueryKey() }) }); }} data-testid={`form-quote-notes-${item.id}`}><textarea name="notes" defaultValue={item.adminNotes || ''} aria-label={`Private notes for quote ${item.id}`} maxLength={4000} style={{ minWidth: 210, minHeight: 56 }} data-testid={`input-quote-notes-${item.id}`} /><button className="text-link" type="submit" disabled={update.isPending} data-testid={`button-save-quote-notes-${item.id}`}>Save notes <Check size={13} /></button></form></td></tr>)}</tbody></table></div> : <Empty title="No quote requests" body="Submitted requests will appear here." />}</QueryState>{update.isError && <ErrorNotice message="The quote could not be updated." />}{update.isSuccess && <div className="notice success">Quote record updated.</div>}</section>
    {selected && <section className="panel" style={{ marginTop: 14 }}><div className="panel-title"><h2>Quote Q-{selected.id} details</h2><button className="btn btn-outline" onClick={() => setSelected(null)} data-testid="button-close-quote-details"><X size={14} /> Close</button></div><div className="legal-copy"><p>{selected.description || 'No cargo description provided.'}</p><p>Weight: {selected.weight ?? 'Not provided'} · Dimensions: {selected.dimensions || 'Not provided'}<br />Preferred ship date: {selected.preferredShippingDate ? new Date(selected.preferredShippingDate).toLocaleDateString() : 'Not provided'}<br />Additional information: {selected.additionalInformation || 'None provided'}</p></div></section>}
  </DashboardFrame>;
}
function AdminCustomers() {
  const [search, setSearch] = useState('');
  const params = useMemo(() => ({ search: search || undefined }), [search]);
  const q = useGetAdminCustomers(params);
  return <DashboardFrame admin><DashHeading title="Customers" sub="Customer records available to operations." />
    <div className="toolbar"><input className="search-input" aria-label="Search customers" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or email" data-testid="input-customer-search" /><span className="badge">{q.data?.length ?? '—'} records</span></div>
    <section className="panel"><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Address</th><th>Joined</th></tr></thead><tbody>{q.data.map(user => <tr key={user.id} data-testid={`row-customer-${user.id}`}><td><strong>{user.name}</strong><br /><span className="mono">Customer #{user.id}</span></td><td>{user.email}</td><td>{user.phone || 'Not provided'}</td><td>{[user.address, user.country].filter(Boolean).join(', ') || 'Not provided'}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <Empty title="No customer records" body="Customer records will appear when accounts are connected." />}</QueryState></section>
  </DashboardFrame>;
}
function AdminMessages() {
  const q = useGetAdminContacts();
  const update = useUpdateContact();
  const cache = useQueryClient();
  const [detail, setDetail] = useState<Contact | null>(null);
  return <DashboardFrame admin><DashHeading title="Messages" sub="Customer inquiries and their follow-up status." />
    <section className="panel"><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Received</th><th>From</th><th>Subject</th><th>Status</th><th>Actions</th></tr></thead><tbody>{q.data.map(item => <tr key={item.id} data-testid={`row-message-${item.id}`}><td>{new Date(item.createdAt).toLocaleDateString()}</td><td>{item.name}<br />{item.email}</td><td>{item.subject}</td><td><StatusBadge status={item.status} /></td><td><button className="text-link" onClick={() => setDetail(detail?.id === item.id ? null : item)} data-testid={`button-message-open-${item.id}`}>{detail?.id === item.id ? 'Close' : 'Read'} <ArrowRight size={13} /></button><select style={{ marginLeft: 9 }} aria-label={`Update message ${item.id}`} value={item.status} onChange={e => update.mutate({ id: item.id, data: { status: e.target.value as 'new' | 'in_progress' | 'closed' } }, { onSuccess: () => cache.invalidateQueries({ queryKey: getGetAdminContactsQueryKey() }) })} data-testid={`select-message-status-${item.id}`}><option value="new">New</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></td></tr>)}</tbody></table></div> : <Empty title="No messages" body="New contact inquiries will be listed here." />}</QueryState>{update.isError && <ErrorNotice message="Message status could not be updated." />}</section>
    {detail && <section className="panel" style={{ marginTop: 15 }}><div className="panel-title"><h2>{detail.subject}</h2><button className="btn btn-outline" onClick={() => setDetail(null)} data-testid="button-close-message"><X size={14} /> Close</button></div><p>{detail.name} · {detail.email} · {detail.phone || 'No phone'}</p><div className="notice info" style={{ whiteSpace: 'pre-wrap' }}>{detail.message}</div></section>}
  </DashboardFrame>;
}
function AdminUsers() {
  const q = useGetAdminUsers();
  const change = useUpdateUserRole();
  const cache = useQueryClient();
  return <DashboardFrame admin><DashHeading title="Users & roles" sub="Role changes are recorded by the operations API. Only authorized administrators may apply them." />
    <section className="panel"><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Account status</th><th>Role</th><th>Created</th></tr></thead><tbody>{q.data.map(user => <tr key={user.id} data-testid={`row-user-${user.id}`}><td><strong>{user.name}</strong><br />{user.email}</td><td><StatusBadge status={user.status} /></td><td><select aria-label={`Change role for ${user.name}`} value={user.role} disabled={change.isPending || user.role === 'super_admin'} onChange={e => change.mutate({ id: user.id, data: { role: e.target.value as 'admin' | 'staff' | 'customer' } }, { onSuccess: () => cache.invalidateQueries({ queryKey: getGetAdminUsersQueryKey() }) })} data-testid={`select-user-role-${user.id}`}><option value="super_admin" disabled>Super admin</option><option value="customer">Customer</option><option value="staff">Staff</option><option value="admin">Admin</option></select></td><td>{new Date(user.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <Empty title="No user records" body="Users connected to the operations API will appear here." />}</QueryState>{change.isError && <ErrorNotice message="User role could not be changed. Confirm your administrator permissions." />}</section>
  </DashboardFrame>;
}
function AdminAudit() {
  const q = useGetAdminAuditLogs();
  return <DashboardFrame admin><DashHeading title="Audit log" sub="A record of administrative actions returned by the API." />
    <section className="panel"><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>Details</th><th>IP address</th></tr></thead><tbody>{q.data.map(log => <tr key={log.id} data-testid={`row-audit-${log.id}`}><td>{new Date(log.createdAt).toLocaleString()}</td><td>{log.userName || 'System'}</td><td>{log.action}</td><td>{log.entityType}{log.entityId ? ` #${log.entityId}` : ''}</td><td className="mono">{log.metadata ? JSON.stringify(log.metadata) : '—'}</td><td className="mono">{log.ipAddress || '—'}</td></tr>)}</tbody></table></div> : <Empty title="No audit entries" body="When administrative actions are recorded, they will appear here." />}</QueryState></section>
  </DashboardFrame>;
}
function AdminSettings() {
  const q = useGetSiteSettings();
  const update = useUpdateSiteSettings();
  const cache = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [jsonError, setJsonError] = useState('');
  return <DashboardFrame admin><DashHeading title="Site settings" sub="Configure the public company profile and service information." />
    <section className="panel" style={{ maxWidth: 850 }}><QueryState loading={q.isLoading} error={q.isError} retry={() => q.refetch()}>{q.data && <form onSubmit={e => {
      e.preventDefault(); setSaved(false); setJsonError('');
      const f = new FormData(e.currentTarget);
      let services: SiteSettingsUpdate['services'];
      let statistics: SiteSettingsUpdate['statistics'];
      let testimonials: SiteSettingsUpdate['testimonials'];
      try {
        services = JSON.parse(String(f.get('services'))) as SiteSettingsUpdate['services'];
        statistics = JSON.parse(String(f.get('statistics'))) as SiteSettingsUpdate['statistics'];
        testimonials = JSON.parse(String(f.get('testimonials'))) as SiteSettingsUpdate['testimonials'];
        if (!Array.isArray(services) || !Array.isArray(statistics) || !Array.isArray(testimonials)) throw new Error('Arrays required');
      } catch { setJsonError('Services, statistics, and testimonials must each be valid JSON arrays. No changes were saved.'); return; }
      const payload: SiteSettingsUpdate = { companyName: String(f.get('companyName')), companyDescription: String(f.get('companyDescription')), companyEmail: String(f.get('companyEmail')), companyPhone: String(f.get('companyPhone')), address: String(f.get('address')), website: String(f.get('website')), primaryColor: String(f.get('primaryColor')), services, statistics, testimonials };
      update.mutate({ data: payload }, { onSuccess: () => { setSaved(true); cache.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() }); } });
    }} data-testid="form-site-settings">
      <div className="form-grid"><div className="field"><label htmlFor="setting-name">Company name</label><input id="setting-name" name="companyName" defaultValue={q.data.companyName} data-testid="input-company-name" /></div><div className="field"><label htmlFor="setting-email">Company email</label><input id="setting-email" name="companyEmail" type="email" defaultValue={q.data.companyEmail} data-testid="input-company-email" /></div><div className="field"><label htmlFor="setting-phone">Company phone</label><input id="setting-phone" name="companyPhone" defaultValue={q.data.companyPhone} data-testid="input-company-phone" /></div><div className="field"><label htmlFor="setting-website">Website</label><input id="setting-website" name="website" defaultValue={q.data.website || ''} data-testid="input-company-website" /></div><div className="field full"><label htmlFor="setting-address">Address</label><input id="setting-address" name="address" defaultValue={q.data.address} data-testid="input-company-address" /></div><div className="field full"><label htmlFor="setting-description">Company description</label><textarea id="setting-description" name="companyDescription" defaultValue={q.data.companyDescription} maxLength={1200} data-testid="input-company-description" /></div><div className="field"><label htmlFor="setting-color">Primary color</label><input id="setting-color" name="primaryColor" type="color" defaultValue={q.data.primaryColor || '#213a50'} data-testid="input-primary-color" /></div>
        <div className="field full"><label htmlFor="setting-services">Configured services (JSON)</label><textarea id="setting-services" name="services" defaultValue={JSON.stringify(q.data.services, null, 2)} data-testid="input-company-services" /><small>Each item includes slug, title, and description.</small></div>
        <div className="field full"><label htmlFor="setting-statistics">Verified statistics (JSON)</label><textarea id="setting-statistics" name="statistics" defaultValue={JSON.stringify(q.data.statistics, null, 2)} data-testid="input-company-statistics" /><small>Only enter substantiated operating information.</small></div>
        <div className="field full"><label htmlFor="setting-testimonials">Approved testimonials (JSON)</label><textarea id="setting-testimonials" name="testimonials" defaultValue={JSON.stringify(q.data.testimonials, null, 2)} data-testid="input-company-testimonials" /><small>Only enter content with permission to publish.</small></div>
      </div>
      {jsonError && <div className="notice error" role="alert">{jsonError}</div>}<div className="notice info">Public pages do not present testimonials or statistics as claims. Configure company-approved content before publishing it elsewhere.</div>{update.isError && <ErrorNotice message="Settings could not be saved. Check the provided content and try again." />}{saved && <div className="notice success">Company settings saved.</div>}<div className="form-actions"><button className="btn btn-primary" type="submit" disabled={update.isPending} data-testid="button-save-settings">{update.isPending ? 'Saving…' : 'Save settings'} <Check size={14} /></button></div>
    </form>}</QueryState></section>
  </DashboardFrame>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={appearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your workspace.' } },
      signUp: { start: { title: 'Create your account', subtitle: 'Set up access to your freight workspace.' } },
    }}
    routerPush={(to: string) => setLocation(stripBase(to))}
    routerReplace={(to: string) => setLocation(stripBase(to), { replace: true })}
  >
    <ClerkCacheInvalidator />
    <ClerkTokenSync />
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={ClerkSignIn} />
      <Route path="/sign-up/*?" component={ClerkSignUp} />
      <Route path="/about" component={AboutPage} />
      <Route path="/services" component={ServicesPage} />
      <Route path="/services/:slug" component={ServiceRoute} />
      <Route path="/tracking" component={TrackingPage} />
      <Route path="/quote" component={QuotePage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/privacy" component={() => <LegalPage slug="privacy" />} />
      <Route path="/terms" component={() => <LegalPage slug="terms" />} />
      <Route path="/cookie-policy" component={() => <LegalPage slug="cookie-policy" />} />
      <Route path="/dashboard" component={() => <Protected><DashboardEntry /></Protected>} />
      <Route path="/admin" component={() => <Protected admin><AdminHome /></Protected>} />
      <Route path="/admin/shipments" component={() => <Protected admin><AdminShipments /></Protected>} />
      <Route path="/admin/shipments/new" component={() => <Protected admin><CreateShipmentPage /></Protected>} />
      <Route path="/admin/shipments/:id" component={ShipmentDetailRoute} />
      <Route path="/admin/quotes" component={() => <Protected admin><AdminQuotes /></Protected>} />
      <Route path="/admin/customers" component={() => <Protected admin><AdminCustomers /></Protected>} />
      <Route path="/admin/messages" component={() => <Protected admin><AdminMessages /></Protected>} />
      <Route path="/admin/users" component={() => <Protected admin><AdminUsers /></Protected>} />
      <Route path="/admin/audit" component={() => <Protected admin><AdminAudit /></Protected>} />
      <Route path="/admin/settings" component={() => <Protected admin><AdminSettings /></Protected>} />
      <Route component={NotFound} />
    </Switch>
  </ClerkProvider>;
}
function ServiceRoute() {
  const [location] = useLocation();
  const slug = location.split('/').filter(Boolean)[1];
  return <ServiceDetail slug={slug} />;
}
function ShipmentDetailRoute() {
  const [location] = useLocation();
  const id = location.split('/').filter(Boolean)[2];
  return <Protected admin><ShipmentDetailPage id={id} /></Protected>;
}
function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ErrorBoundary><ClerkRoutes /></ErrorBoundary>
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  </QueryClientProvider>;
}

export default App;