import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@thermaldesk/contracts', '@thermaldesk/excel', '@thermaldesk/analysis', '@thermaldesk/coordination', '@thermaldesk/intake'],
  // Band loads optional provider adapters lazily; let Node resolve them only if used.
  serverExternalPackages: ['exceljs', 'pdf-to-img', 'pdfjs-dist', '@band-ai/sdk'],
};
export default config;
