import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@thermaldesk/contracts', '@thermaldesk/excel', '@thermaldesk/analysis'],
  serverExternalPackages: ['exceljs'],
};
export default config;
