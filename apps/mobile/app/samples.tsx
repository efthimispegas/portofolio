import { useState } from "react";
import { Alert, FlatList, View } from "react-native";
import { router } from "expo-router";
import { demoCards } from "@mastoli/core";
import { ProviderTile } from "../src/components/provider-card";
import { Button, Copy } from "../src/components/ui";
import { useWallet } from "../src/lib/wallet-context";
// Presentation order follows the approved stack preview. Saving is always explicit.
const sampleOrder = ["elena-home", "petros-electric", "nikos-water"];
const samples = [...demoCards].sort(
  (a, b) => sampleOrder.indexOf(a.slug) - sampleOrder.indexOf(b.slug),
);
export default function Samples() {
  const { t, save } = useWallet();
  const [busy, setBusy] = useState(false);
  const addSamples = async () => {
    setBusy(true);
    try {
      for (const card of [...samples].reverse()) await save(card);
      router.replace("/");
    } catch {
      Alert.alert(t("error"), t("retry"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FlatList
      data={samples}
      keyExtractor={(card) => card.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 22, paddingBottom: 40, gap: 18 }}
      ListHeaderComponent={
        <View style={{ gap: 18 }}>
          <Copy muted>{t("sampleBody")}</Copy>
          <Button
            title={t("trySamples")}
            busy={busy}
            onPress={() => void addSamples()}
          />
        </View>
      }
      renderItem={({ item }) => (
        <ProviderTile
          card={item}
          onPress={() =>
            router.push({
              pathname: "/card/[slug]",
              params: { slug: item.slug, sample: "1" },
            })
          }
        />
      )}
    />
  );
}
