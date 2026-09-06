import { ResetPassword } from '../../components/auth-actions';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token = '', error } = await searchParams;
  return (
    <ResetPassword
      token={token}
      error={error ? 'This reset link expired or is invalid. Request a new one.' : undefined}
    />
  );
}
