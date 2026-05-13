import { redirect } from 'next/navigation';

/**
 * Root / → /cs (landing). Authed buyer/promoter jsou redirectovaní po login
 * podle role; anonymní visitor vidí landing s upcoming events.
 */
export default function HomePage() {
  redirect('/cs');
}
