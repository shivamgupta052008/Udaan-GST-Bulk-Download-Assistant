/**
 * GST Portal Detector
 * Analyzes URL and page characteristics without scraping or storing any sensitive credentials.
 */

export interface PortalStatus {
  isGSTPortal: boolean;
  isReturnsDashboard: boolean;
  isLoggedIn: boolean | null;
  currentUrl: string;
  detectedPage: string;
}

export type PageClassification =
  | 'NOT_GST_PORTAL'
  | 'GST_PORTAL_HOME'
  | 'GST_PORTAL_LOGIN'
  | 'GST_RETURNS_DASHBOARD'
  | 'GST_AUTH_DASHBOARD'
  | 'GST_SERVICES_OTHER';

export function isGstDomainHost(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().trim();
  return (
    h === 'gst.gov.in' ||
    h === 'services.gst.gov.in' ||
    h === 'www.gst.gov.in' ||
    h === 'return.gst.gov.in' ||
    h === 'payment.gst.gov.in' ||
    h === 'ewaybillgst.gov.in' ||
    h === 'einvoice1.gst.gov.in' ||
    h.endsWith('.gst.gov.in') ||
    h === 'cbic-gst.gov.in' ||
    h.endsWith('.cbic-gst.gov.in') ||
    h.endsWith('.cbic.gov.in')
  );
}

export function detectPortalStatus(
  rawUrl: string,
  pageMetadata?: {
    title?: string;
    hasLoginButton?: boolean;
    hasUserGreeting?: boolean;
    hasDashboardBreadcrumb?: boolean;
    pathname?: string;
  }
): PortalStatus {
  const currentUrl = (rawUrl || '').trim();

  if (!currentUrl) {
    return {
      isGSTPortal: false,
      isReturnsDashboard: false,
      isLoggedIn: null,
      currentUrl: '',
      detectedPage: 'No active page detected',
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(currentUrl);
  } catch {
    // If protocol was missing, try parsing with https
    try {
      parsed = new URL(`https://${currentUrl}`);
    } catch {
      return {
        isGSTPortal: false,
        isReturnsDashboard: false,
        isLoggedIn: null,
        currentUrl,
        detectedPage: 'Invalid URL / Non-web tab',
      };
    }
  }

  const hostname = (parsed.hostname || '').toLowerCase();
  const isGst = isGstDomainHost(hostname);

  if (!isGst) {
    return {
      isGSTPortal: false,
      isReturnsDashboard: false,
      isLoggedIn: null,
      currentUrl,
      detectedPage: 'Non-GST Site',
    };
  }

  const pathname = (pageMetadata?.pathname || parsed.pathname || '').toLowerCase();
  const hash = (parsed.hash || '').toLowerCase();
  const title = (pageMetadata?.title || '').toLowerCase();
  const fullPath = `${pathname} ${hash}`;

  // 1. Check Login Page FIRST (to avoid false returns match if login has ?redirect=/returns)
  const isLoginExplicitPath =
    pathname.includes('/services/login') ||
    pathname.includes('/gp/login') ||
    pathname.includes('/auth/login') ||
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    hash.includes('/login');

  const hasLoginUiSignals =
    pageMetadata?.hasLoginButton === true ||
    (title.includes('login') && !title.includes('dashboard')) ||
    title.includes('authenticate');

  if (isLoginExplicitPath || hasLoginUiSignals) {
    return {
      isGSTPortal: true,
      isReturnsDashboard: false,
      isLoggedIn: false, // User is on login page
      currentUrl,
      detectedPage: 'GST Portal — Login Page',
    };
  }

  // 2. Check Returns Dashboard
  const isReturnsPath =
    pathname.includes('/services/returns') ||
    pathname.includes('/returns-dashboard') ||
    pathname.includes('/services/auth/returns') ||
    pathname.startsWith('/returns/') ||
    pathname === '/returns' ||
    hash.includes('/returns') ||
    hash.includes('returns-dashboard') ||
    title.includes('returns dashboard') ||
    title.includes('file returns') ||
    title.includes('return dashboard') ||
    pageMetadata?.hasDashboardBreadcrumb === true;

  if (isReturnsPath) {
    return {
      isGSTPortal: true,
      isReturnsDashboard: true,
      isLoggedIn: true, // Returns dashboard is only reachable inside authenticated zone
      currentUrl,
      detectedPage: 'GST Returns Dashboard',
    };
  }

  // 3. Check Auth / Main User Dashboard
  const isAuthDashboard =
    pathname.includes('/services/auth/dashboard') ||
    pathname.includes('/auth/dashboard') ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    hash.includes('/dashboard') ||
    pageMetadata?.hasUserGreeting === true ||
    title.includes('welcome') ||
    (title.includes('dashboard') && !title.includes('returns'));

  if (isAuthDashboard) {
    return {
      isGSTPortal: true,
      isReturnsDashboard: false,
      isLoggedIn: true,
      currentUrl,
      detectedPage: 'GST Portal — Main Dashboard (Returns not opened)',
    };
  }

  // 4. Generic GST portal services
  return {
    isGSTPortal: true,
    isReturnsDashboard: false,
    isLoggedIn: pageMetadata?.hasUserGreeting ? true : null,
    currentUrl,
    detectedPage: 'GST Portal (General Services)',
  };
}
