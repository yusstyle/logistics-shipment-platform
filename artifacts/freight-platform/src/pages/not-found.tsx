import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="not-found" data-testid="page-not-found">
      <Link href="/" className="wordmark" data-testid="link-not-found-home">
        <img className="wordmark-logo" src="/logo.svg" alt="GLO-PAX" aria-label="GLO-PAX" />
        <span>GLO-PAX</span>
      </Link>
      <div className="not-found-content">
        <span className="eyebrow">Route not found</span>
        <p className="not-found-code">404</p>
        <h1>This route has no destination.</h1>
        <p>Check the address, or return to the public home page to find the right next step.</p>
        <Link href="/" className="btn btn-primary" data-testid="button-not-found-home"><ArrowLeft size={15} /> Back to home</Link>
      </div>
    </main>
  );
}