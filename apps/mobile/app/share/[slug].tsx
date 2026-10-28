import {
  Alert,
  ScrollView,
  Share,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useWallet } from "../../src/lib/wallet-context";
import { useTheme } from "../../src/lib/theme";
import { cardUrl } from "../../src/lib/config";
import { PublicQr } from "../../src/components/public-qr";
import { Button, Copy, styles } from "../../src/components/ui";
export default function ShareCard() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { cards, t } = useWallet();
  const c = useTheme();
  const { width } = useWindowDimensions();
  const card = cards.find((item) => item.card.slug === slug)?.card;
  if (!card)
    return (
      <View style={styles.content}>
        <Copy>{t("unavailable")}</Copy>
        <Button title={t("close")} onPress={() => router.back()} />
      </View>
    );
  const url = cardUrl(card.slug);
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.content,
        { gap: 20, alignItems: "center" },
      ]}
    >
      <Text
        style={{
          fontSize: 26,
          fontWeight: "700",
          textAlign: "center",
          color: c.text,
        }}
      >
        {card.displayName}
      </Text>
      <Copy muted>{t("qrBody")}</Copy>
      <View style={{ padding: 12, backgroundColor: "#FFF", borderRadius: 20 }}>
        <PublicQr url={url} availableSize={Math.min(width - 76, 300)} />
      </View>
      <Text
        selectable
        style={{
          fontSize: 14,
          lineHeight: 21,
          textAlign: "center",
          color: c.secondary,
        }}
      >
        {url}
      </Text>
      {card.isDemo ? <Copy muted>{t("demoShare")}</Copy> : null}
      <View style={{ alignSelf: "stretch", gap: 12 }}>
        <Button
          title={t("share")}
          icon="share"
          onPress={() =>
            void Share.share({ message: `${card.displayName}\n${url}` }).catch(
              () => Alert.alert(t("error"), t("actionUnavailable")),
            )
          }
        />
        <Button title={t("close")} secondary onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}
