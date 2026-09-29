import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@thermaldesk/contracts', '@thermaldesk/excel'],
  serverExternalPackages: ['exceljs'],
};
export default config;
