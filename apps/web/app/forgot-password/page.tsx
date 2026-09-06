import { AuthForm } from '../../components/auth-form';
import { config, isLocal } from '@platform/core/config';
export const dynamic = 'force-dynamic';
export default function Page() {
  return <AuthForm name={config.name} local={isLocal()} mode="forgot" />;
}
