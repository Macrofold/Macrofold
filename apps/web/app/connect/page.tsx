import type { Metadata } from 'next';
import { CustomerConnect } from '../../components/customer-connect';
import './connect.css';
export const metadata: Metadata = {
  title: 'Connect your account · Macrofold',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function ConnectPage() {
  return <CustomerConnect />;
}
