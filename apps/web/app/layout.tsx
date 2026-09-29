import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ThermalDesk — Repair operations', description: 'One inspection. Every action. Verified completion.' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
