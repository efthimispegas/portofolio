import { useLocalSearchParams } from "expo-router";
import { CardDetailContent } from "../../src/components/card-detail-content";
export default function CardDetail() {
  const { slug, sample } = useLocalSearchParams<{
    slug: string;
    sample?: string;
  }>();
  return <CardDetailContent slug={slug} sample={sample} />;
}
