import { Redirect, useLocalSearchParams } from "expo-router";
export default function CardLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: "/card/[slug]", params: { slug } }} />;
}
