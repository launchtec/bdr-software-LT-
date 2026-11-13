import type { NextConfig } from 'next';

const config: NextConfig = {
  // The web app only reads the database. The audit engine (and its headless browser)
  // runs elsewhere and pushes results in through /api/ingest.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
};

export default config;
