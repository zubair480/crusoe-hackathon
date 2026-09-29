import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@thermaldesk/contracts', '@thermaldesk/excel', '@thermaldesk/analysis', '@thermaldesk/coordination', '@thermaldesk/intake'],
  serverExternalPackages: ['exceljs', 'pdf-to-img', 'pdfjs-dist'],
};
export default config;
