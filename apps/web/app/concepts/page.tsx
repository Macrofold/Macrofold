import { config } from '@platform/core/config';
import { ConceptGallery } from '../../components/concepts/site';
export default function Page() {
  return <ConceptGallery name={config.name} />;
}
