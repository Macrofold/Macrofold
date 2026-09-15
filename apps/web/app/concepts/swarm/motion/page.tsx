import type { Metadata } from 'next';
import { SwarmMotionStudio } from '../../../../components/swarm-motion/studio';
import '../../../../components/swarm-motion/swarm-motion.css';

export const metadata: Metadata = {
  title: 'Swarm · Motion studies',
  description: 'Five animated interpretations of the original Swarm particle field.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SwarmMotionStudio />;
}
